import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import BulkUploadForm from './bulk-upload-form'

export default async function BulkUploadPage() {
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

  if (profile?.role !== 'admin') {
    redirect('/')
  }

  return <BulkUploadForm />
}