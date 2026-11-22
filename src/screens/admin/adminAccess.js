import { supabase } from '../../lib/supabase';

export async function fetchAdminAccess() {
  const { data, error } = await supabase.rpc('admin_current_access');
  if (error) throw error;
  return data;
}

export function canViewAdminPage(access, pageKey) {
  if (access?.is_super_admin) return true;
  const permission = access?.permissions?.[pageKey];
  return !!(permission?.can_view || permission?.can_manage);
}

export function canManageAdminPage(access, pageKey) {
  return !!(access?.is_super_admin || access?.permissions?.[pageKey]?.can_manage);
}
