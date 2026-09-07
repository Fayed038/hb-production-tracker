/**
 * Bulk-upload Excel import — name/machine normalization mappings.
 *
 * এই ফাইলটাই একমাত্র জায়গা যেখানে normalization ঠিক করতে হবে।
 * নতুন ভুল বানান/variation পেলে শুধু নিচের লিস্টে একটা এন্ট্রি যোগ করুন —
 * বাকি কোডে কিছু বদলাতে হবে না।
 *
 * প্রতিটা ম্যাপে: key = Excel ফাইলে যেভাবে লেখা থাকতে পারে (lowercase, trimmed করে মেলানো হয়)
 *                value = canonical/সঠিক নাম যেটা ডাটাবেজে যাবে
 */

// ── MACHINES ────────────────────────────────────────────────────────────
// Excel-এ মেশিনের কোড (bracket-এর ভেতরের অংশ, যেমন "M8-IND-2024-01") দিয়ে মেলানো হয়।
// key = machine code (uppercase, trimmed), value = canonical machine name (machines টেবিলের `name` কলামের সাথে মিলতে হবে)
export const MACHINE_CODE_MAP: Record<string, string> = {
  'M8-IND-2024-01': 'Making-01',
  'M8-EN-2017-01': 'Making-02',
  'M8-IN-2024-02': 'Making-03',
  'M8-CH-2025-01': 'Making-04',
  'M8-IND-2026-01': 'Making-05',
  'M8-CH-2016-01': 'Making-06',
  // Making-07 এর কোনো কোড না-ও থাকতে পারে — তখন নাম দিয়ে ম্যাচ হবে (নিচে দেখুন)
  'SS-IN-2015-01-BM': 'Duplex Set',
  'HL10-CH-2015-01-BM': "HLP 10's Set-01",
  'HL10-CH-2026-01-BM': "HLP 10's Set-02",
  'HL10-CH-2026-02-BM': "HLP 10's Set-02",
  'HL20-CH-2015-01-BM': "HLP 20's Set-01",
  'HL-SG-2025-01-BM': "HLP 20's Set-02",
  'HL20R-CH-2025-01-BM': "HLP 20's Set-03 Seal Pack",
}

// যদি কোনো লাইনে কোড না থাকে (bracket ছাড়া), তখন নামের প্রথম অংশ দিয়ে ফলব্যাক ম্যাচ হবে।
// key = Excel-এ যেভাবে নামটা শুরু হয় (lowercase), value = canonical machine name
export const MACHINE_NAME_FALLBACK_MAP: Record<string, string> = {
  'making-01': 'Making-01',
  'making-02': 'Making-02',
  'making-03': 'Making-03',
  'making-04': 'Making-04',
  'making-05': 'Making-05',
  'making-06': 'Making-06',
  'making-07': 'Making-07',
  'duplex set': 'Duplex Set',
  "hlp 10's set-01": "HLP 10's Set-01",
  "hlp 10's set-02": "HLP 10's Set-02",
  "hlp 20's set-01": "HLP 20's Set-01",
  "hlp 20's set-02": "HLP 20's Set-02",
  "hlp 20's set-03": "HLP 20's Set-03 Seal Pack",
}

// ── SUPERVISORS ─────────────────────────────────────────────────────────
// key = Excel-এ যেভাবে লেখা থাকতে পারে (lowercase, trimmed), value = canonical নাম
export const SUPERVISOR_MAP: Record<string, string> = {
  'israfil': 'Md. Israfil',
  'md. israfil': 'Md. Israfil',
  'md.israfil': 'Md. Israfil',
  'md. isnafil': 'Md. Israfil',

  'saiful': 'Md. Saiful Islam',
  'md. saiful': 'Md. Saiful Islam',
  'md. saiful islam': 'Md. Saiful Islam',
  'md.saiful islam': 'Md. Saiful Islam',

  'tasin': 'Md. Tasin',
  'md. tasin': 'Md. Tasin',
  'md. tanin': 'Md. Tasin',

  'md. shahriar': 'Md. Shahriar',
  'md. shahniar': 'Md. Shahriar',
  'md. shahnian': 'Md. Shahriar',

  'md. raju': 'Md. Raju',
  'md. rojle': 'Md. Raju',

  'md. shobuj': 'Md. Shobuj',
}

// ── OPERATORS ───────────────────────────────────────────────────────────
// key = Excel-এ যেভাবে লেখা থাকতে পারে (lowercase, trimmed), value = canonical নাম
// সোর্স: আগের সেশনে ইউজারের সাথে এক-এক করে কনফার্ম করা চূড়ান্ত লিস্ট
export const OPERATOR_MAP: Record<string, string> = {
  // Md. Shohel
  'md. sohel': 'Md. Shohel', 'shohel': 'Md. Shohel', 'sohel': 'Md. Shohel', 'md. shohel': 'Md. Shohel',
  // Abdur Rashid (machine operator variant, distinct spelling group)
  'abdur rashed': 'Abdur Rashid', 'md. abdur rashid': 'Abdur Rashid', 'abdur rashid': 'Abdur Rashid',
  // Md. Nurul Kader
  'md. nunul kader': 'Md. Nurul Kader', 'md. nurul kader': 'Md. Nurul Kader',
  // Md. Jamal
  'jamal': 'Md. Jamal', 'md. jama': 'Md. Jamal', 'md. jamal': 'Md. Jamal',
  // Hazrat Ali
  'haznat ali': 'Hazrat Ali', 'hazrat ali': 'Hazrat Ali',
  // Md. Jahangir
  'jahangir': 'Md. Jahangir', 'md. jahangin': 'Md. Jahangir', 'md. jahangir': 'Md. Jahangir',
  // Din Islam
  'dim islam': 'Din Islam', 'din islam': 'Din Islam', 'md. d. islam': 'Din Islam',
  // Md. Robbani
  'md. robbane': 'Md. Robbani', 'md. robban': 'Md. Robbani', 'md. robbani': 'Md. Robbani',
  // Md. Ibrahim
  'md. ibnahim': 'Md. Ibrahim', 'md. ibrahim': 'Md. Ibrahim',
  // Md. Alamgir
  'md. alamgin': 'Md. Alamgir', 'md. alamgir': 'Md. Alamgir',
  // Md. Khadiza
  'khadiza': 'Md. Khadiza', 'khadiza (h)': 'Md. Khadiza', 'khadizal': 'Md. Khadiza',
  'khadizal (h)': 'Md. Khadiza', 'msto khadiza': 'Md. Khadiza', 'msto khadiza (h)': 'Md. Khadiza',
  'md. khadiza': 'Md. Khadiza',
  // Md. Shahriar (operator — separate from supervisor Shahriar, but same spelling fixes)
  'md. shahniar': 'Md. Shahriar', 'md. shahnian': 'Md. Shahriar', 'md. shahriar': 'Md. Shahriar',
  // Md. Shahin — CONFIRMED a DIFFERENT person, never merge with Md. Shahriar
  'md. shahim': 'Md. Shahin', 'md. shahin': 'Md. Shahin',
  // Showrov
  'md. shownov': 'Showrov', 'shownov': 'Showrov', 'shoconov': 'Showrov', 'showrov': 'Showrov',
  // Md. Rashid (distinct group from Abdur Rashid above)
  'md. rashidul': 'Md. Rashid', 'md. rashed': 'Md. Rashid', 'md. rashid': 'Md. Rashid',
  // Md. Tanjil
  'md. tanzil': 'Md. Tanjil', 'md. tanjil': 'Md. Tanjil',
  // Md. Shohag
  'md. shahag': 'Md. Shohag', 'md. shohag': 'Md. Shohag',
  // Md. Nasrul
  'md. najrul': 'Md. Nasrul', 'md. nasrul': 'Md. Nasrul',
  // Md. Hazrat
  'md. hozrat': 'Md. Hazrat', 'md. hazrot': 'Md. Hazrat', 'md. hazrat': 'Md. Hazrat',
  // Md. Shakil
  'md. shakil': 'Md. Shakil', 'md. shikil': 'Md. Shakil',
  // Md. Monsur
  'md. monsur': 'Md. Monsur', 'md. monsun': 'Md. Monsur', 'md. minsun': 'Md. Monsur',
  // Md. Ismail
  'ismail': 'Md. Ismail', 'md. ismile': 'Md. Ismail', 'md. ismail': 'Md. Ismail',
}

// ── Helper functions ────────────────────────────────────────────────────

function cleanKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Machine code বা bracket-হীন নাম দিয়ে canonical machine name খুঁজে বের করে। না পেলে null। */
export function resolveMachineName(rawLine: string): { name: string | null; matchedBy: 'code' | 'name' | null } {
  const codeMatch = rawLine.match(/\(([^)]+)\)/)
  if (codeMatch) {
    const code = codeMatch[1].trim().toUpperCase()
    if (MACHINE_CODE_MAP[code]) {
      return { name: MACHINE_CODE_MAP[code], matchedBy: 'code' }
    }
  }
  const lower = cleanKey(rawLine.replace(/\([^)]*\)/g, ''))
  for (const prefix of Object.keys(MACHINE_NAME_FALLBACK_MAP)) {
    if (lower.startsWith(prefix)) {
      return { name: MACHINE_NAME_FALLBACK_MAP[prefix], matchedBy: 'name' }
    }
  }
  return { name: null, matchedBy: null }
}

/** Supervisor নাম normalize করে। ম্যাপে না থাকলে raw (trim করা) নামটাই ফেরত দেয় এবং matched=false। */
export function resolveSupervisorName(raw: string): { name: string; matched: boolean } {
  const key = cleanKey(raw.replace(/^supervisor( name)?:?/i, ''))
  const mapped = SUPERVISOR_MAP[key]
  return mapped ? { name: mapped, matched: true } : { name: raw.trim(), matched: false }
}

/** Operator নাম normalize করে। ম্যাপে না থাকলে raw (trim করা) নামটাই ফেরত দেয় এবং matched=false। */
export function resolveOperatorName(raw: string): { name: string; matched: boolean } {
  const key = cleanKey(raw.replace(/^operator( name)?:?/i, ''))
  const mapped = OPERATOR_MAP[key]
  return mapped ? { name: mapped, matched: true } : { name: raw.trim(), matched: false }
}