'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

type ProductionRow = {
  item_type: string
  quantity: number | null
  unit: string
  is_stopped: boolean
  shift_entry_id: string
}

type ShiftEntryRow = {
  id: string
  shift: string
  machine_id: string
  report_date: string
}

type MachineRow = { id: string; name: string; category: string }

function prettifyType(itemType: string) {
  if (itemType === 'output') return 'Output'
  return itemType
    .replace(/^wastage_/, '')
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export default function ReportsPage() {
  const supabase = createClient()
  const router = useRouter()

  const [mode, setMode] = useState<'daily' | 'monthly'>('daily')
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7)) // YYYY-MM

  const [machines, setMachines] = useState<MachineRow[]>([])
  const [shiftEntries, setShiftEntries] = useState<ShiftEntryRow[]>([])
  const [items, setItems] = useState<ProductionRow[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const load = async () => {
      setLoading(true)

      let startDate: string
      let endDate: string
      if (mode === 'daily') {
        startDate = selectedDate
        endDate = selectedDate
      } else {
        const [y, m] = selectedMonth.split('-').map(Number)
        startDate = `${selectedMonth}-01`
        const lastDay = new Date(y, m, 0).getDate()
        endDate = `${selectedMonth}-${String(lastDay).padStart(2, '0')}`
      }

      const { data: reports } = await supabase
        .from('daily_reports')
        .select('id, report_date')
        .gte('report_date', startDate)
        .lte('report_date', endDate)

      const reportIds = (reports ?? []).map((r) => r.id)
      const reportDateById = new Map((reports ?? []).map((r) => [r.id, r.report_date]))

      if (reportIds.length === 0) {
        setShiftEntries([])
        setItems([])
        setLoading(false)
        return
      }

      const { data: entries } = await supabase
        .from('shift_entries')
        .select('id, shift, machine_id, daily_report_id')
        .in('daily_report_id', reportIds)

      const entryRows: ShiftEntryRow[] = (entries ?? []).map((e: any) => ({
        id: e.id,
        shift: e.shift,
        machine_id: e.machine_id,
        report_date: reportDateById.get(e.daily_report_id) ?? '',
      }))
      setShiftEntries(entryRows)

      const entryIds = entryRows.map((e) => e.id)
      if (entryIds.length === 0) {
        setItems([])
        setLoading(false)
        return
      }

      const { data: prodItems } = await supabase
        .from('production_items')
        .select('item_type, quantity, unit, is_stopped, shift_entry_id')
        .in('shift_entry_id', entryIds)

      setItems((prodItems ?? []) as ProductionRow[])

      const { data: m } = await supabase.from('machines').select('id, name, category')
      if (m) setMachines(m)

      setLoading(false)
    }
    load()
  }, [mode, selectedDate, selectedMonth])

  // Overall totals by item_type+unit
  const overallTotals = useMemo(() => {
    const totals: Record<string, { qty: number; unit: string }> = {}
    items.forEach((it) => {
      if (it.quantity == null) return
      const key = it.item_type + '|' + it.unit
      if (!totals[key]) totals[key] = { qty: 0, unit: it.unit }
      totals[key].qty += Number(it.quantity)
    })
    return Object.entries(totals).map(([key, val]) => ({
      item_type: key.split('|')[0],
      qty: val.qty,
      unit: val.unit,
    }))
  }, [items])

  // Per machine+shift breakdown
  const perMachineRows = useMemo(() => {
    const machineById = new Map(machines.map((m) => [m.id, m]))
    const itemsByEntry: Record<string, ProductionRow[]> = {}
    items.forEach((it) => {
      if (!itemsByEntry[it.shift_entry_id]) itemsByEntry[it.shift_entry_id] = []
      itemsByEntry[it.shift_entry_id].push(it)
    })

    return shiftEntries
      .map((se) => {
        const machine = machineById.get(se.machine_id)
        const entryItems = itemsByEntry[se.id] ?? []
        const output = entryItems.find((it) => it.item_type === 'output')
        const wastageItems = entryItems.filter((it) => it.item_type !== 'output' && it.quantity != null)
        return {
          date: se.report_date,
          machine: machine ? `${machine.name}` : '—',
          shift: se.shift,
          output: output?.is_stopped ? 'বন্ধ ছিল' : output?.quantity != null ? `${Number(output.quantity).toLocaleString('en-IN')} stick` : '—',
          wastageText: wastageItems
            .map((w) => `${prettifyType(w.item_type)}: ${Number(w.quantity).toLocaleString('en-IN')}${w.unit}`)
            .join(', '),
        }
      })
      .sort((a, b) => (a.date + a.machine + a.shift).localeCompare(b.date + b.machine + b.shift))
  }, [shiftEntries, items, machines])

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-xl font-bold text-gray-900">রিপোর্ট</h1>
          <button onClick={() => router.push('/')} className="text-sm text-gray-600 border rounded px-3 py-1">
            ← প্রধান পাতায় ফিরে যান
          </button>
        </div>

        <div className="bg-white p-4 rounded-lg shadow mb-6 flex flex-wrap items-center gap-4">
          <div className="flex border rounded overflow-hidden">
            <button
              onClick={() => setMode('daily')}
              className={`px-4 py-2 text-sm ${mode === 'daily' ? 'bg-black text-white' : 'text-gray-700'}`}
            >
              দৈনিক
            </button>
            <button
              onClick={() => setMode('monthly')}
              className={`px-4 py-2 text-sm ${mode === 'monthly' ? 'bg-black text-white' : 'text-gray-700'}`}
            >
              মাসিক
            </button>
          </div>

          {mode === 'daily' ? (
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="border rounded px-3 py-2 text-gray-900"
            />
          ) : (
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="border rounded px-3 py-2 text-gray-900"
            />
          )}
        </div>

        {loading && <p className="text-gray-500">লোড হচ্ছে...</p>}

        {!loading && overallTotals.length === 0 && (
          <p className="text-gray-500">এই সময়ের জন্য কোনো ডেটা পাওয়া যায়নি।</p>
        )}

        {!loading && overallTotals.length > 0 && (
          <>
            <h2 className="text-sm font-semibold text-gray-900 mb-2">সার্বিক সমষ্টি (Overall Summary)</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mb-8">
              {overallTotals.map((t) => (
                <div key={t.item_type + t.unit} className="bg-white p-4 rounded-lg shadow">
                  <p className="text-xs text-gray-500">{prettifyType(t.item_type)}</p>
                  <p className="text-lg font-semibold text-gray-900">
                    {t.qty.toLocaleString('en-IN')} {t.unit}
                  </p>
                </div>
              ))}
            </div>

            <h2 className="text-sm font-semibold text-gray-900 mb-2">মেশিন-ওয়ারি বিবরণ</h2>
            <div className="bg-white rounded-lg shadow overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-500">
                    <th className="p-3">তারিখ</th>
                    <th className="p-3">মেশিন</th>
                    <th className="p-3">শিফট</th>
                    <th className="p-3">Output</th>
                    <th className="p-3">Wastage</th>
                  </tr>
                </thead>
                <tbody>
                  {perMachineRows.map((row, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="p-3 text-gray-900">{row.date}</td>
                      <td className="p-3 text-gray-900">{row.machine}</td>
                      <td className="p-3 text-gray-900">{row.shift}</td>
                      <td className="p-3 text-gray-900">{row.output}</td>
                      <td className="p-3 text-gray-600">{row.wastageText || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}