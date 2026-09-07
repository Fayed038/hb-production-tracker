/**
 * Bulk-upload Excel parser.
 *
 * পুরনো মাসিক Excel ফাইল (দুইটা ভিন্ন টেমপ্লেট ফরম্যাট মিশে থাকতে পারে) পড়ে
 * প্রতিটা মেশিন-শিফট ব্লককে একটা structured object-এ রূপান্তর করে —
 * সরাসরি ডাটাবেজে insert করে না, শুধু preview-এর জন্য ডেটা রেডি করে।
 *
 * ব্যবহার: parseWorkbook(file) → ParsedEntry[]
 * এরপর preview টেবিলে দেখানো হবে, ইউজার "Confirm & Import" চাপলে তবেই
 * আলাদা import.ts ফাংশন দিয়ে Supabase-এ পাঠানো হবে।
 *
 * নতুন/অচেনা ফরম্যাট পেলে এই ফাইল কখনো ডেটা বাদ দিয়ে চুপচাপ এগোয় না —
 * প্রতিটা সমস্যা entry.warnings অথবা top-level parse errors-এ যোগ হয়,
 * যাতে preview স্ক্রিনে স্পষ্ট দেখা যায়।
 */

import * as XLSX from 'xlsx'
import { resolveMachineName, resolveSupervisorName, resolveOperatorName } from './normalization'

// ── Types ───────────────────────────────────────────────────────────────

export type ParsedProductionItem = {
  item_type: string // 'output' | 'wastage_...'
  label: string // display label, e.g. "Wastage Cigarette"
  quantity: number | null
  unit: string
  is_stopped: boolean
}

export type ParsedOperator = {
  raw: string
  name: string
  matched: boolean
}

export type ParsedEntry = {
  sourceSheet: string
  reportDate: string // 'YYYY-MM-DD'
  shift: 'A' | 'B'
  machineRaw: string
  machineName: string | null
  machineMatchedBy: 'code' | 'name' | null
  floorFrom: string
  floorTo: string
  supervisorRaw: string
  supervisorName: string
  supervisorMatched: boolean
  operators: ParsedOperator[]
  openingStock: number | null
  closingStock: number | null
  downtimeNote: string
  isStopped: boolean
  items: ParsedProductionItem[]
  warnings: string[] // problems specific to this block — shown per-row in preview
}

export type ParseResult = {
  entries: ParsedEntry[]
  fileErrors: string[] // sheet-level problems that stopped a whole sheet from parsing
}

// ── Helpers ─────────────────────────────────────────────────────────────

function sheetNameToDate(sheetName: string): string | null {
  // "01.07.26" -> "2026-07-01"
  const m = sheetName.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/)
  if (!m) return null
  const [, dd, mm, yy] = m
  const year = yy.length === 2 ? `20${yy}` : yy
  return `${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
}

function dateFromLabelCell(value: string): string | null {
  // "18.07.2026" or embedded in "... Date: 01.07.26"
  const m = value.match(/(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})/)
  if (!m) return null
  const [, dd, mm, yy] = m
  const year = yy.length === 2 ? `20${yy}` : yy
  return `${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
}

/** "5,70,000" / "9,29,200 Stick" / "24,000 gm" → { value, unit } */
function parseQuantity(raw: unknown): { value: number | null; unit: string | null } {
  if (raw === null || raw === undefined) return { value: null, unit: null }
  const str = String(raw).trim()
  if (str === '' || /^[-—–]+$/.test(str)) return { value: null, unit: null }
  const m = str.match(/^([\d,]+(?:\.\d+)?)\s*([a-zA-Z]+)?/)
  if (!m) return { value: null, unit: null }
  const num = Number(m[1].replace(/,/g, ''))
  if (Number.isNaN(num)) return { value: null, unit: null }
  return { value: num, unit: m[2] ? m[2].toLowerCase() : null }
}

function itemTypeFromLabel(label: string): string {
  const l = label.trim().toLowerCase()
  if (l === 'output') return 'output'
  return 'wastage_' + l.replace(/^wastage\s+/, '').trim().replace(/\s+/g, '_')
}

function blankEntry(sourceSheet: string, reportDate: string, shift: 'A' | 'B'): ParsedEntry {
  return {
    sourceSheet,
    reportDate,
    shift,
    machineRaw: '',
    machineName: null,
    machineMatchedBy: null,
    floorFrom: '',
    floorTo: '',
    supervisorRaw: '',
    supervisorName: '',
    supervisorMatched: false,
    operators: [],
    openingStock: null,
    closingStock: null,
    downtimeNote: '',
    isStopped: false,
    items: [],
    warnings: [],
  }
}

function parseFromTo(text: string): { from: string; to: string } {
  const m = text.match(/from\s*(.+?)\s*to\s*(.+)/i)
  if (m) return { from: m[1].trim(), to: m[2].trim() }
  return { from: '', to: '' }
}

// ── Core: parse one "side" (Shift A columns or Shift B columns) of one sheet ──

function parseSide(
  rows: unknown[][],
  colOffset: number,
  shift: 'A' | 'B',
  sourceSheet: string,
  reportDate: string,
  fileErrors: string[]
): ParsedEntry[] {
  const entries: ParsedEntry[] = []
  let current: ParsedEntry | null = null
  let expectMachineName = false // format 2: saw "SHIFT: A" row, next non-empty row is the machine name
  let inTable = false

  const flush = () => {
    if (current) {
      if (!current.machineName) {
        current.warnings.push(
          `মেশিন নাম "${current.machineRaw}" চেনা যায়নি — normalization.ts এ MACHINE_CODE_MAP/MACHINE_NAME_FALLBACK_MAP এ যোগ করতে হবে।`
        )
      }
      if (!current.supervisorMatched && current.supervisorRaw) {
        current.warnings.push(
          `সুপারভাইজার নাম "${current.supervisorRaw}" normalization.ts এর SUPERVISOR_MAP এ পাওয়া যায়নি — raw নাম ব্যবহার হয়েছে, চেক করে নিন।`
        )
      }
      current.operators.forEach((op) => {
        if (!op.matched) {
          current!.warnings.push(
            `অপারেটর নাম "${op.raw}" normalization.ts এর OPERATOR_MAP এ পাওয়া যায়নি — raw নাম ব্যবহার হয়েছে, চেক করে নিন।`
          )
        }
      })
      if (current.items.length === 0) {
        current.warnings.push('কোনো output/wastage আইটেম পাওয়া যায়নি এই ব্লকে।')
      }
      entries.push(current)
    }
    current = null
    inTable = false
  }

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] ?? []
    const cell = row[colOffset]
    const cellStr = typeof cell === 'string' ? cell.trim() : ''

    if (cellStr === '') continue

    // --- Format 2: "SHIFT: A" / "SHIFT: B" marker row ---
    const shiftMarkerMatch = cellStr.match(/^SHIFT:\s*([AB])$/i)
    if (shiftMarkerMatch) {
      flush()
      expectMachineName = true
      continue
    }

    // --- Format 1: "Making-01 (CODE) - SHIFT A" all-in-one header ---
    const inlineHeaderMatch = cellStr.match(/^(.*?)\s*-\s*SHIFT\s*([AB])\s*$/i)
    if (inlineHeaderMatch && !expectMachineName) {
      flush()
      current = blankEntry(sourceSheet, reportDate, shift)
      current.machineRaw = inlineHeaderMatch[1].trim()
      const resolved = resolveMachineName(current.machineRaw)
      current.machineName = resolved.name
      current.machineMatchedBy = resolved.matchedBy
      continue
    }

    // --- Format 2: machine name line right after "SHIFT: X" ---
    if (expectMachineName) {
      current = blankEntry(sourceSheet, reportDate, shift)
      current.machineRaw = cellStr
      const resolved = resolveMachineName(current.machineRaw)
      current.machineName = resolved.name
      current.machineMatchedBy = resolved.matchedBy
      expectMachineName = false
      continue
    }

    if (!current) {
      // Text outside any recognized block — could be a report-level note (e.g. top "Opening (Shift A): ..." line).
      // Never silently dropped, but also not guessable which block it belongs to.
      if (/opening/i.test(cellStr)) continue // top-of-sheet opening line, not per-machine — intentionally skipped, no DB field for it
      continue
    }

    // --- Floor running ---
    const floorInline = cellStr.match(/^Floor Running:\s*(.+)$/i)
    if (floorInline) {
      const { from, to } = parseFromTo(floorInline[1])
      current.floorFrom = from
      current.floorTo = to
      continue
    }
    if (/^Floor Running \(From-To\):$/i.test(cellStr)) {
      const val = row[colOffset + 1]
      if (typeof val === 'string') {
        const { from, to } = parseFromTo(val)
        current.floorFrom = from
        current.floorTo = to
      }
      continue
    }

    // --- Supervisor ---
    const supInline = cellStr.match(/^Supervisor:\s*(.+)$/i)
    if (supInline) {
      current.supervisorRaw = supInline[1].trim()
      const resolved = resolveSupervisorName(current.supervisorRaw)
      current.supervisorName = resolved.name
      current.supervisorMatched = resolved.matched
      continue
    }
    if (/^Supervisor Name:$/i.test(cellStr)) {
      const val = row[colOffset + 1]
      if (typeof val === 'string' && val.trim()) {
        current.supervisorRaw = val.trim()
        const resolved = resolveSupervisorName(current.supervisorRaw)
        current.supervisorName = resolved.name
        current.supervisorMatched = resolved.matched
      }
      continue
    }

    // --- Operator ---
    const opInline = cellStr.match(/^Operator Name:\s*(.+)$/i)
    if (opInline) {
      const raw = opInline[1].trim()
      const resolved = resolveOperatorName(raw)
      current.operators.push({ raw, name: resolved.name, matched: resolved.matched })
      continue
    }
    if (/^Operator Name:$/i.test(cellStr)) {
      const val = row[colOffset + 1]
      if (typeof val === 'string' && val.trim()) {
        const raw = val.trim()
        const resolved = resolveOperatorName(raw)
        current.operators.push({ raw, name: resolved.name, matched: resolved.matched })
      }
      continue
    }

    // --- Table header row ---
    if (cellStr === 'S.N') {
      inTable = true
      continue
    }

    // --- Item row (S.N is a number) ---
    if (inTable && typeof cell === 'number') {
      const label = row[colOffset + 1]
      const qtyRaw = row[colOffset + 2]
      if (typeof label !== 'string' || !label.trim()) {
        current.warnings.push(`লাইন নম্বর ${cell} এ আইটেমের নাম পাওয়া যায়নি — এই সারিটা এড়িয়ে যাওয়া হয়েছে।`)
        continue
      }
      const labelClean = label.trim()
      const { value, unit } = parseQuantity(qtyRaw)
      const remarksUnit = row[colOffset + 3]
      const finalUnit = unit ?? (typeof remarksUnit === 'string' ? remarksUnit.trim().toLowerCase() : '') ?? ''

      if (labelClean.toLowerCase() === 'output') {
        current.items.push({
          item_type: 'output',
          label: labelClean,
          quantity: value,
          unit: finalUnit || 'stick',
          is_stopped: false,
        })
      } else {
        if (value === null) {
          current.warnings.push(`"${labelClean}" এর quantity পড়া যায়নি (raw মান: "${String(qtyRaw)}") — চেক করুন।`)
        }
        current.items.push({
          item_type: itemTypeFromLabel(labelClean),
          label: labelClean,
          quantity: value,
          unit: finalUnit || 'gm',
          is_stopped: false,
        })
      }
      continue
    }

    // --- Closing / stoppage note (format 1: "Clossing :50,000", format 2: "Closing / Stoppage note:") ---
    const closingMatch = cellStr.match(/^Clos?sing\s*:?\s*([\d,]+)/i)
    if (closingMatch) {
      current.closingStock = Number(closingMatch[1].replace(/,/g, ''))
      continue
    }
    if (/^Closing \/ Stoppage note:$/i.test(cellStr)) {
      const val = row[colOffset + 1]
      if (typeof val === 'string' && val.trim()) {
        const closeNum = val.match(/Closing:\s*([\d,]+)/i)
        if (closeNum) current.closingStock = Number(closeNum[1].replace(/,/g, ''))
        current.downtimeNote = current.downtimeNote ? `${current.downtimeNote} | ${val.trim()}` : val.trim()
      }
      continue
    }

    // --- Anything else with text after the table started (downtime/machine-stop notes, "Note:" lines) ---
    if (inTable || current.items.length > 0) {
      current.downtimeNote = current.downtimeNote ? `${current.downtimeNote} | ${cellStr}` : cellStr
      if (/stop/i.test(cellStr)) current.isStopped = /\bstopped?\b/i.test(cellStr) && /^\s*$/.test('')
      continue
    }

    // Anything unrecognized before the table starts inside a known block
    current.warnings.push(`অচেনা লাইন: "${cellStr}" — ম্যানুয়ালি চেক করুন।`)
  }

  flush()
  return entries
}

// ── Entry point ─────────────────────────────────────────────────────────

export async function parseWorkbook(file: File): Promise<ParseResult> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })

  const entries: ParsedEntry[] = []
  const fileErrors: string[] = []

  for (const sheetName of wb.SheetNames) {
    try {
      const ws = wb.Sheets[sheetName]
      const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true })

      let reportDate = sheetNameToDate(sheetName)
      if (!reportDate) {
        // try to find a "Date:" cell in the first few rows
        for (let r = 0; r < Math.min(5, rows.length) && !reportDate; r++) {
          for (const cell of rows[r] ?? []) {
            if (typeof cell === 'string') {
              const found = dateFromLabelCell(cell)
              if (found) {
                reportDate = found
                break
              }
            }
          }
        }
      }
      if (!reportDate) {
        fileErrors.push(`শিট "${sheetName}": তারিখ বের করা যায়নি (শিটের নাম বা কনটেন্ট থেকে) — পুরো শিটটা স্কিপ করা হয়েছে।`)
        continue
      }

      const sideA = parseSide(rows, 0, 'A', sheetName, reportDate, fileErrors)
      const sideB = parseSide(rows, 5, 'B', sheetName, reportDate, fileErrors)
      entries.push(...sideA, ...sideB)
    } catch (err) {
      fileErrors.push(`শিট "${sheetName}" পার্স করতে গিয়ে এরর হয়েছে: ${err instanceof Error ? err.message : String(err)} — এই শিটটা স্কিপ করা হয়েছে।`)
    }
  }

  return { entries, fileErrors }
}