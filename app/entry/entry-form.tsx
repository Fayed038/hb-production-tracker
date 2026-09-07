'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

type Machine = { id: string; name: string; code: string | null; category: string }
type Employee = { id: string; name: string; role: string }
type WastageType = { id: string; name: string; default_unit: string; categories: string[] | null }
type RoleLabel = { category: string; role_label: string; sort_order: number }

export default function EntryForm() {
  const supabase = createClient()
  const router = useRouter()

  const [machines, setMachines] = useState<Machine[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [wastageTypes, setWastageTypes] = useState<WastageType[]>([])
  const [roleLabels, setRoleLabels] = useState<RoleLabel[]>([])

  const [reportDate, setReportDate] = useState(new Date().toISOString().split('T')[0])
  const [machineId, setMachineId] = useState('')
  const [shift, setShift] = useState<'A' | 'B'>('A')
  const [floorFrom, setFloorFrom] = useState('')
  const [floorTo, setFloorTo] = useState('')
  const [supervisorId, setSupervisorId] = useState('')

  const [operatorIds, setOperatorIds] = useState<string[]>([])
  const [roleAssignments, setRoleAssignments] = useState<Record<string, string>>({})

  const [openingStock, setOpeningStock] = useState('')
  const [closingStock, setClosingStock] = useState('')
  const [outputQty, setOutputQty] = useState('')
  const [downtimeNote, setDowntimeNote] = useState('')
  const [isStopped, setIsStopped] = useState(false)
  const [wastageQty, setWastageQty] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    const load = async () => {
      const [{ data: m }, { data: e }, { data: w }, { data: r }] = await Promise.all([
        supabase.from('machines').select('id, name, code, category').eq('active', true).order('category').order('name'),
        supabase.from('employees').select('id, name, role').eq('active', true).order('name'),
        supabase.from('wastage_types').select('id, name, default_unit, categories').eq('active', true).order('sort_order'),
        supabase.from('machine_role_labels').select('category, role_label, sort_order').order('sort_order'),
      ])
      if (m) { setMachines(m); if (m.length > 0) setMachineId(m[0].id) }
      if (e) setEmployees(e)
      if (w) setWastageTypes(w)
      if (r) setRoleLabels(r)
    }
    load()
  }, [])

  const supervisors = employees.filter((e) => e.role === 'supervisor' || e.role === 'both')
  const operators = employees.filter((e) => e.role === 'operator' || e.role === 'both')

  const selectedMachine = machines.find((m) => m.id === machineId)
  const visibleWastageTypes = wastageTypes.filter(
    (wt) => !wt.categories || (selectedMachine && wt.categories.includes(selectedMachine.category))
  )
  const namedRoles = roleLabels.filter((r) => selectedMachine && r.category === selectedMachine.category)
  const usesNamedRoles = namedRoles.length > 0

  const toggleOperator = (id: string) => {
    setOperatorIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const resetPerMachineFields = () => {
    setOperatorIds([])
    setRoleAssignments({})
    setOutputQty('')
    setDowntimeNote('')
    setIsStopped(false)
    setWastageQty({})
    setOpeningStock('')
    setClosingStock('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setMessage('')

    let { data: existingReport } = await supabase
      .from('daily_reports')
      .select('id')
      .eq('report_date', reportDate)
      .maybeSingle()

    let reportId = existingReport?.id

    if (!reportId) {
      const { data: newReport, error: reportError } = await supabase
        .from('daily_reports')
        .insert({ report_date: reportDate, upload_method: 'form' })
        .select('id')
        .single()
      if (reportError) {
        setMessage('রিপোর্ট তৈরিতে সমস্যা হয়েছে: ' + reportError.message)
        setSaving(false)
        return
      }
      reportId = newReport.id
    }

    const supervisorName = supervisors.find((s) => s.id === supervisorId)?.name ?? ''

    let operatorNamesDisplay = ''
    if (usesNamedRoles) {
      operatorNamesDisplay = namedRoles
        .map((r) => {
          const empId = roleAssignments[r.role_label]
          const empName = operators.find((o) => o.id === empId)?.name
          return empName ? `${r.role_label}: ${empName}` : null
        })
        .filter(Boolean)
        .join(', ')
    } else {
      operatorNamesDisplay = operators
        .filter((o) => operatorIds.includes(o.id))
        .map((o) => o.name)
        .join(', ')
    }

    const floorRunningNote = floorFrom || floorTo ? `From ${floorFrom} to ${floorTo}` : ''

    const { data: existingShiftEntry } = await supabase
      .from('shift_entries')
      .select('id')
      .eq('daily_report_id', reportId)
      .eq('machine_id', machineId)
      .eq('shift', shift)
      .maybeSingle()

    let shiftEntryId: string

    if (existingShiftEntry) {
      const { error: updateError } = await supabase
        .from('shift_entries')
        .update({
          supervisor_name: supervisorName,
          operator_names: operatorNamesDisplay,
          floor_running_note: floorRunningNote,
          opening_stock: openingStock ? Number(openingStock) : null,
          closing_stock: closingStock ? Number(closingStock) : null,
          downtime_note: downtimeNote,
        })
        .eq('id', existingShiftEntry.id)

      if (updateError) {
        setMessage('এন্ট্রি আপডেট করতে সমস্যা হয়েছে: ' + updateError.message)
        setSaving(false)
        return
      }

      shiftEntryId = existingShiftEntry.id
      await supabase.from('production_items').delete().eq('shift_entry_id', shiftEntryId)
      await supabase.from('shift_entry_operators').delete().eq('shift_entry_id', shiftEntryId)
    } else {
      const { data: newShiftEntry, error: shiftError } = await supabase
        .from('shift_entries')
        .insert({
          daily_report_id: reportId,
          machine_id: machineId,
          shift,
          supervisor_name: supervisorName,
          operator_names: operatorNamesDisplay,
          floor_running_note: floorRunningNote,
          opening_stock: openingStock ? Number(openingStock) : null,
          closing_stock: closingStock ? Number(closingStock) : null,
          downtime_note: downtimeNote,
        })
        .select('id')
        .single()

      if (shiftError) {
        setMessage('এন্ট্রি সংরক্ষণে সমস্যা হয়েছে: ' + shiftError.message)
        setSaving(false)
        return
      }
      shiftEntryId = newShiftEntry.id
    }

    const operatorRows: { shift_entry_id: string; role_label: string; employee_id: string }[] = []
    if (usesNamedRoles) {
      namedRoles.forEach((r) => {
        const empId = roleAssignments[r.role_label]
        if (empId) operatorRows.push({ shift_entry_id: shiftEntryId, role_label: r.role_label, employee_id: empId })
      })
    } else {
      operatorIds.forEach((empId) => {
        operatorRows.push({ shift_entry_id: shiftEntryId, role_label: 'Operator', employee_id: empId })
      })
    }
    if (operatorRows.length > 0) {
      await supabase.from('shift_entry_operators').insert(operatorRows)
    }

    const items: { shift_entry_id: string; item_type: string; quantity: number | null; unit: string; is_stopped: boolean }[] = [
      {
        shift_entry_id: shiftEntryId,
        item_type: 'output',
        quantity: isStopped ? null : outputQty ? Number(outputQty) : null,
        unit: 'stick',
        is_stopped: isStopped,
      },
    ]

    visibleWastageTypes.forEach((wt) => {
      const qty = wastageQty[wt.id]
      if (qty && qty.trim() !== '') {
        items.push({
          shift_entry_id: shiftEntryId,
          item_type: 'wastage_' + wt.name.toLowerCase().replace(/\s+/g, '_'),
          quantity: Number(qty),
          unit: wt.default_unit,
          is_stopped: false,
        })
      }
    })

    const { error: itemsError } = await supabase.from('production_items').insert(items)
    setSaving(false)

    if (itemsError) {
      setMessage('আইটেম সংরক্ষণে সমস্যা হয়েছে: ' + itemsError.message)
      return
    }

    setMessage(
      existingShiftEntry
        ? '✅ পূর্বের এন্ট্রি আপডেট করা হয়েছে। পরবর্তী মেশিন নির্বাচন করে অগ্রসর হন।'
        : '✅ সফলভাবে সংরক্ষিত হয়েছে। একই শিফটের জন্য পরবর্তী মেশিন নির্বাচন করে অগ্রসর হন।'
    )
    resetPerMachineFields()
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-xl font-bold text-gray-900">নতুন রিপোর্ট এন্ট্রি</h1>
          <button onClick={() => router.push('/')} className="text-sm text-gray-600 border rounded px-3 py-1">
            ← প্রধান পাতায় ফিরে যান
          </button>
        </div>

        <form onSubmit={handleSubmit} className="bg-white p-6 rounded-lg shadow space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-900">তারিখ</label>
              <input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} className="w-full border rounded px-3 py-2 text-gray-900" required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-900">শিফট</label>
              <select value={shift} onChange={(e) => setShift(e.target.value as 'A' | 'B')} className="w-full border rounded px-3 py-2 text-gray-900">
                <option value="A">Shift A</option>
                <option value="B">Shift B</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-900">Floor Running From</label>
              <input type="time" value={floorFrom} onChange={(e) => setFloorFrom(e.target.value)} className="w-full border rounded px-3 py-2 text-gray-900" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-900">Floor Running To</label>
              <input type="time" value={floorTo} onChange={(e) => setFloorTo(e.target.value)} className="w-full border rounded px-3 py-2 text-gray-900" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-gray-900">সুপারভাইজার (পুরো শিফটের জন্য একজন)</label>
            <select value={supervisorId} onChange={(e) => setSupervisorId(e.target.value)} className="w-full border rounded px-3 py-2 text-gray-900" required>
              <option value="">-- নির্বাচন করুন --</option>
              {supervisors.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-gray-900">মেশিন</label>
            <select
              value={machineId}
              onChange={(e) => { setMachineId(e.target.value); setWastageQty({}); setOperatorIds([]); setRoleAssignments({}) }}
              className="w-full border rounded px-3 py-2 text-gray-900"
              required
            >
              {machines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}{m.code ? ` (${m.code})` : ''}
                </option>
              ))}
            </select>
          </div>

          {usesNamedRoles ? (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-900">অপারেটরগণ</label>
              {namedRoles.map((r) => (
                <div key={r.role_label} className="flex items-center gap-2">
                  <span className="w-32 text-sm text-gray-900">{r.role_label}</span>
                  <select
                    value={roleAssignments[r.role_label] ?? ''}
                    onChange={(e) => setRoleAssignments({ ...roleAssignments, [r.role_label]: e.target.value })}
                    className="flex-1 border rounded px-3 py-1 text-gray-900"
                  >
                    <option value="">-- নির্বাচন করুন --</option>
                    {operators.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-900">অপারেটর(গণ) — একাধিক নির্বাচন করা যাবে</label>
              <div className="grid grid-cols-2 gap-2 border rounded p-3 max-h-48 overflow-y-auto">
                {operators.map((o) => (
                  <label key={o.id} className="flex items-center gap-2 text-sm text-gray-900">
                    <input type="checkbox" checked={operatorIds.includes(o.id)} onChange={() => toggleOperator(o.id)} />
                    {o.name}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-900">Opening Stock</label>
              <input type="number" value={openingStock} onChange={(e) => setOpeningStock(e.target.value)} className="w-full border rounded px-3 py-2 text-gray-900" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-900">Closing Stock</label>
              <input type="number" value={closingStock} onChange={(e) => setClosingStock(e.target.value)} className="w-full border rounded px-3 py-2 text-gray-900" />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input type="checkbox" id="stopped" checked={isStopped} onChange={(e) => setIsStopped(e.target.checked)} />
            <label htmlFor="stopped" className="text-sm text-gray-900">মেশিন বন্ধ ছিল (Stopped)</label>
          </div>

          {!isStopped && (
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-900">Output (stick)</label>
              <input type="number" value={outputQty} onChange={(e) => setOutputQty(e.target.value)} className="w-full border rounded px-3 py-2 text-gray-900" />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-2 text-gray-900">
              Wastage — শুধুমাত্র প্রযোজ্য ঘরগুলো পূরণ করুন, বাকিগুলো ফাঁকা রাখুন
            </label>
            <div className="space-y-2">
              {visibleWastageTypes.map((wt) => (
                <div key={wt.id} className="flex items-center gap-2">
                  <span className="w-40 text-sm text-gray-900">{wt.name}</span>
                  <input
                    type="number"
                    placeholder="—"
                    value={wastageQty[wt.id] ?? ''}
                    onChange={(e) => setWastageQty({ ...wastageQty, [wt.id]: e.target.value })}
                    className="flex-1 border rounded px-3 py-1 text-gray-900"
                  />
                  <span className="w-10 text-sm text-gray-500">{wt.default_unit}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-gray-900">Downtime নোট (প্রযোজ্য হলে)</label>
            <input type="text" value={downtimeNote} onChange={(e) => setDowntimeNote(e.target.value)} className="w-full border rounded px-3 py-2 text-gray-900" />
          </div>

          {message && (
            <p className={message.startsWith('✅') ? 'text-green-600 text-sm' : 'text-red-500 text-sm'}>{message}</p>
          )}

          <button type="submit" disabled={saving} className="w-full bg-black text-white rounded py-2 disabled:opacity-50">
            {saving ? 'সংরক্ষণ করা হচ্ছে...' : 'সংরক্ষণ করুন'}
          </button>
        </form>
      </div>
    </div>
  )
}