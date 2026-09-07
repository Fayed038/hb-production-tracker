import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import LogoutButton from './logout-button'

export default async function Home() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  const isAdmin = profile?.role === 'admin'

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">HB Production Tracker</h1>
          <LogoutButton />
        </div>

        <p className="text-gray-600 mb-6">
          অ্যাকাউন্ট: {user.email} {!isAdmin && <span className="text-xs text-gray-400">(শুধুমাত্র দেখার অনুমতি)</span>}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {isAdmin && (
            <a href="/entry" className="bg-white p-6 rounded-lg shadow hover:shadow-md transition">
              <h2 className="text-lg font-semibold text-gray-900">নতুন রিপোর্ট এন্ট্রি</h2>
              <p className="text-gray-500 text-sm mt-1">আজকের প্রোডাকশন ডেটা প্রদান করুন</p>
            </a>
          )}

          <a href="/reports" className="bg-white p-6 rounded-lg shadow hover:shadow-md transition">
            <h2 className="text-lg font-semibold text-gray-900">রিপোর্ট দেখুন</h2>
            <p className="text-gray-500 text-sm mt-1">দৈনিক ও মাসিক সমষ্টি দেখুন</p>
          </a>
        </div>
      </div>
    </div>
  )
}