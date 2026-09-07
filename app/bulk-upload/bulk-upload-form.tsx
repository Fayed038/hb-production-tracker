'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { parseWorkbook, type ParsedEntry } from './parser'

type Machine = { id: string; name: string }
type Employee = { id: string; name: string }

type ImportOutcome = {
  entry: ParsedEntry
  status: 'imported' | 'skipped'
  reason?: string
}

export default function BulkUploadForm() {
  const supabase = createClient()
  const router = useRouter()

  const [entries, setEntries] = useState<ParsedEntry[] | null>(null)
  const [fileErrors, setFileErrors] = useState<string[]>([])
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResults, setImportResults] = useState<ImportOutcome[] | null>(null)
  const [fileName, setFileName] = useState('')

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setParsing(true)
    setImportResults(null)
    try {
      const result = await parseWorkbook(file)
      setEntries(result.entries)
      setFileErrors(result.fileErrors)
    } catch (err) {
      setFileErrors([`ফাইল পড়তে গিয়ে এরর হয়েছে: ${err instanceof Error ? err.message : String(err)}`])
      setEntries([])
    } finally {
      setParsing(false)
    }
  }

  const blockedEntries = (entries ?? []).filter((e) => !e.machineName)
  const importableEntries = (entries ?? []).filter((e) => !!e.machineName)
  const entriesWithWarnings = (entries ?? []).filter((e) => e.warnings.length > 0)

  const handleConfirmImport = async () => {
    if (!entries) return
    setImporting(true)
    const results: ImportOutcome[] = []

    // Pre-fetch machines & employees once for name → id resolution
    const [{ data: machines }, { data: employees }] = await Promise.all([
      supabase.from('machines').select('id, name'),
      supabase.from('employees').select('id, name'),
    ])
    const machineIdByName = new Map<string, string>((machines ?? []).map((m: Machine) => [m.name, m.id]))
    const employeeIdByName = new Map<string, string>((employees ?? []).map((e: Employee) => [e.name, e.id]))

    for (const entry of importableEntries) {
      try {
        const machineId = machineIdByName.get(entry.machineName as string)
        if (!machineId) {
          results.push({ entry, status: 'skipped', reason: `মেশিন "${entry.machineName}" ডাটাবেজে পাওয়া যায়নি।` })
          continue
        }

        // 1) daily_reports: find or create
        let reportId: string | undefined
        const { data: existingReport } = await supabase
          .from('daily_reports')
          .select('id')
          .eq('report_date', entry.reportDate)
          .maybeSingle()

        if (existingReport) {
          reportId = existingReport.id
        } else {
          const { data: newReport, error: reportErr } = await supabase
            .from('daily_reports')
            .insert({ report_date: entry.reportDate, upload_method: 'bulk_excel' })
            .select('id')
            .single()
          if (reportErr) {
            results.push({ entry, status: 'skipped', reason: `daily_reports তৈরি করতে সমস্যা: ${reportErr.message}` })
            continue
          }
          reportId = newReport.id
        }

        const floorRunningNote = entry.floorFrom || entry.floorTo ? `From ${entry.floorFrom} to ${entry.floorTo}` : ''
        const operatorNamesDisplay = entry.operators.map((o) => o.name).join(', ')

        // 2) shift_entries: find or update-or-create (same convention as the manual entry form)
        const { data: existingShift } = await supabase
          .from('shift_entries')
          .select('id')
          .eq('daily_report_id', reportId)
          .eq('machine_id', machineId)
          .eq('shift', entry.shift)
          .maybeSingle()

        let shiftEntryId: string

        const shiftPayload = {
          supervisor_name: entry.supervisorName,
          operator_names: operatorNamesDisplay,
          floor_running_note: floorRunningNote,
          opening_stock: entry.openingStock,
          closing_stock: entry.closingStock,
          downtime_note: entry.downtimeNote,
        }

        if (existingShift) {
          const { error: updateErr } = await supabase.from('shift_entries').update(shiftPayload).eq('id', existingShift.id)
          if (updateErr) {
            results.push({ entry, status: 'skipped', reason: `shift_entries আপডেট করতে সমস্যা: ${updateErr.message}` })
            continue
          }
          shiftEntryId = existingShift.id
          await supabase.from('production_items').delete().eq('shift_entry_id', shiftEntryId)
          await supabase.from('shift_entry_operators').delete().eq('shift_entry_id', shiftEntryId)
        } else {
          const { data: newShift, error: shiftErr } = await supabase
            .from('shift_entries')
            .insert({ daily_report_id: reportId, machine_id: machineId, shift: entry.shift, ...shiftPayload })
            .select('id')
            .single()
          if (shiftErr) {
            results.push({ entry, status: 'skipped', reason: `shift_entries তৈরি করতে সমস্যা: ${shiftErr.message}` })
            continue
          }
          shiftEntryId = newShift.id
        }

        // 3) shift_entry_operators (skip any operator whose name doesn't match an employee — never guess an id)
        const operatorRows = entry.operators
          .map((o) => employeeIdByName.get(o.name))
          .filter((id): id is string => !!id)
          .map((employee_id) => ({ shift_entry_id: shiftEntryId, role_label: 'Operator', employee_id }))
        if (operatorRows.length > 0) {
          await supabase.from('shift_entry_operators').insert(operatorRows)
        }

        // 4) production_items
        const items = entry.items.map((it) => ({
          shift_entry_id: shiftEntryId,
          item_type: it.item_type,
          quantity: entry.isStopped && it.item_type === 'output' ? null : it.quantity,
          unit: it.unit,
          is_stopped: it.item_type === 'output' ? entry.isStopped : false,
        }))
        if (items.length > 0) {
          const { error: itemsErr } = await supabase.from('production_items').insert(items)
          if (itemsErr) {
            results.push({ entry, status: 'skipped', reason: `production_items তৈরি করতে সমস্যা: ${itemsErr.message}` })
            continue
          }
        }

        results.push({ entry, status: 'imported' })
      } catch (err) {
        results.push({ entry, status: 'skipped', reason: err instanceof Error ? err.message : String(err) })
      }
    }

    for (const entry of blockedEntries) {
      results.push({ entry, status: 'skipped', reason: 'মেশিন নাম চেনা যায়নি — normalization.ts এ যোগ করে আবার আপলোড করুন।' })
    }

    setImportResults(results)
    setImporting(false)
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-xl font-bold text-gray-900">Excel Bulk Upload</h1>
          <button onClick={() => router.push('/')} className="text-sm text-gray-600 border rounded px-3 py-1">
            প্রধান পাতায় ফিরে যান
          </button>
        </div>

        <div className="bg-white p-6 rounded-lg shadow mb-6">
          <label className="block text-sm font-medium mb-2 text-gray-900">মাসিক Excel ফাইল সিলেক্ট করুন</label>
          <input type="file" accept=".xlsx,.xls" onChange={handleFileChange} className="text-gray-900" />
          {parsing && <p className="text-sm text-gray-500 mt-2">পার্স করা হচ্ছে...</p>}
          {fileName && !parsing && <p className="text-sm text-gray-500 mt-2">ফাইল: {fileName}</p>}
        </div>

        {fileErrors.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <h2 className="font-semibold text-red-700 mb-2">ফাইল-লেভেল সমস্যা</h2>
            <ul className="list-disc list-inside text-sm text-red-700 space-y-1">
              {fileErrors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )}

        {entries && entries.length > 0 && !importResults && (
          <>
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-white p-4 rounded-lg shadow text-center">
                <div className="text-2xl font-bold text-gray-900">{entries.length}</div>
                <div className="text-sm text-gray-500">মোট এন্ট্রি পাওয়া গেছে</div>
              </div>
              <div className="bg-white p-4 rounded-lg shadow text-center">
                <div className="text-2xl font-bold text-amber-600">{entriesWithWarnings.length}</div>
                <div className="text-sm text-gray-500">ওয়ার্নিং সহ এন্ট্রি</div>
              </div>
              <div className="bg-white p-4 rounded-lg shadow text-center">
                <div className="text-2xl font-bold text-red-600">{blockedEntries.length}</div>
                <div className="text-sm text-gray-500">Import করা যাবে না (মেশিন অচেনা)</div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow overflow-x-auto mb-6">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-100 text-gray-700">
                  <tr>
                    <th className="px-3 py-2">তারিখ</th>
                    <th className="px-3 py-2">শিফট</th>
                    <th className="px-3 py-2">মেশিন</th>
                    <th className="px-3 py-2">সুপারভাইজার</th>
                    <th className="px-3 py-2">অপারেটর</th>
                    <th className="px-3 py-2">আইটেম</th>
                    <th className="px-3 py-2">ওয়ার্নিং</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry, i) => (
                    <tr
                      key={i}
                      className={`border-t ${!entry.machineName ? 'bg-red-50' : entry.warnings.length > 0 ? 'bg-amber-50' : ''}`}
                    >
                      <td className="px-3 py-2 text-gray-900 whitespace-nowrap">{entry.reportDate}</td>
                      <td className="px-3 py-2 text-gray-900">{entry.shift}</td>
                      <td className="px-3 py-2 text-gray-900">
                        {entry.machineName ?? <span className="text-red-600 font-medium">{entry.machineRaw || '(খালি)'}</span>}
                      </td>
                      <td className="px-3 py-2 text-gray-900">
                        {entry.supervisorName}
                        {!entry.supervisorMatched && entry.supervisorRaw && (
                          <span className="text-amber-600"> ⚠</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-900">
                        {entry.operators.map((o) => o.name).join(', ')}
                        {entry.operators.some((o) => !o.matched) && <span className="text-amber-600"> ⚠</span>}
                      </td>
                      <td className="px-3 py-2 text-gray-900">{entry.items.length}টা</td>
                      <td className="px-3 py-2 text-xs text-gray-700 max-w-xs">
                        {entry.warnings.length > 0 && (
                          <ul className="list-disc list-inside space-y-0.5">
                            {entry.warnings.map((w, wi) => (
                              <li key={wi}>{w}</li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              onClick={handleConfirmImport}
              disabled={importing || importableEntries.length === 0}
              className="w-full bg-black text-white rounded py-3 font-medium disabled:opacity-50"
            >
              {importing
                ? 'Import করা হচ্ছে...'
                : `Confirm & Import (${importableEntries.length}টা এন্ট্রি Supabase-এ যাবে)`}
            </button>
          </>
        )}

        {entries && entries.length === 0 && !fileErrors.length && (
          <p className="text-gray-500">এই ফাইলে কোনো এন্ট্রি খুঁজে পাওয়া যায়নি।</p>
        )}

        {importResults && (
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="font-semibold text-gray-900 mb-4">Import ফলাফল</h2>
            <p className="text-sm text-gray-700 mb-4">
              ✅ {importResults.filter((r) => r.status === 'imported').length}টা সফলভাবে ইমপোর্ট হয়েছে &nbsp;|&nbsp; ❌{' '}
              {importResults.filter((r) => r.status === 'skipped').length}টা স্কিপ হয়েছে
            </p>
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-100 text-gray-700">
                <tr>
                  <th className="px-3 py-2">তারিখ</th>
                  <th className="px-3 py-2">শিফট</th>
                  <th className="px-3 py-2">মেশিন</th>
                  <th className="px-3 py-2">অবস্থা</th>
                  <th className="px-3 py-2">কারণ</th>
                </tr>
              </thead>
              <tbody>
                {importResults.map((r, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-3 py-2 text-gray-900">{r.entry.reportDate}</td>
                    <td className="px-3 py-2 text-gray-900">{r.entry.shift}</td>
                    <td className="px-3 py-2 text-gray-900">{r.entry.machineName ?? r.entry.machineRaw}</td>
                    <td className="px-3 py-2">
                      {r.status === 'imported' ? (
                        <span className="text-green-600">✅ Imported</span>
                      ) : (
                        <span className="text-red-600">❌ Skipped</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-700 text-xs">{r.reason ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}