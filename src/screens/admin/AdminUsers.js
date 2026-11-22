import React, { useEffect, useState } from 'react';
import { Alert, FlatList, Text, View } from 'react-native';
import { supabase, PAGE_SIZE } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import { Btn, Card, Chip, Input, Label, Loader, Muted, Pager } from '../../components/ui';
import { ADMIN_PERMISSION_PAGES } from './adminPages';
import { fetchAdminAccess } from './adminAccess';
import { C } from '../../lib/theme';

export default function AdminUsers() {
  const { session } = useAuth();
  const [access, setAccess] = useState(null);
  const [rows, setRows] = useState([]);
  const [email, setEmail] = useState('');
  const [permissions, setPermissions] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const currentAccess = await fetchAdminAccess();
      setAccess(currentAccess);
      if (!currentAccess.is_super_admin) return;
      const { data, error } = await supabase.rpc('admin_list_users');
      if (error) throw error;
      setRows(Array.isArray(data) ? data : []);
    } catch (error) {
      Alert.alert('Could not load admin accounts', error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const toggle = (pageKey, action) => {
    setPermissions((current) => {
      const old = current[pageKey] || {};
      if (action === 'can_manage') {
        const canManage = !old.can_manage;
        return { ...current, [pageKey]: { can_view: canManage || !!old.can_view, can_manage: canManage } };
      }
      const canView = !old.can_view;
      return { ...current, [pageKey]: { can_view: canView, can_manage: canView ? !!old.can_manage : false } };
    });
  };

  const edit = (row) => {
    setEmail(row.email || '');
    setPermissions(row.permissions || {});
    setEditingId(row.user_id);
  };

  const clearForm = () => {
    setEmail('');
    setPermissions({});
    setEditingId(null);
  };

  const save = async () => {
    const selected = ADMIN_PERMISSION_PAGES
      .filter(({ key }) => permissions[key]?.can_view || permissions[key]?.can_manage)
      .map(({ key }) => ({
        page_key: key,
        can_view: !!(permissions[key]?.can_view || permissions[key]?.can_manage),
        can_manage: !!permissions[key]?.can_manage,
      }));
    const { error } = await supabase.rpc('admin_set_user_access', {
      p_email: email.trim(),
      p_permissions: selected,
    });
    if (error) return Alert.alert('Could not save admin access', error.message);
    Alert.alert('Admin access saved', 'The user must sign out and back in to refresh their access.');
    clearForm();
    load();
  };

  const remove = (row) => {
    Alert.alert('Remove admin access?', `This will remove admin access from ${row.email}.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        const { error } = await supabase.rpc('admin_remove_user_access', { p_email: row.email });
        if (error) Alert.alert('Could not remove admin access', error.message);
        else { if (editingId === row.user_id) clearForm(); load(); }
      } },
    ]);
  };

  if (loading) return <Loader />;
  if (!access?.is_super_admin) {
    return <View style={{ padding: 20 }}><Muted>Only the super admin can manage admin accounts.</Muted></View>;
  }

  return (
    <FlatList
      data={rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)}
      keyExtractor={(row) => row.user_id}
      ListHeaderComponent={(
        <View>
          <Card style={{ marginTop: 12 }}>
            <Text style={{ color: C.text, fontSize: 18, fontWeight: '800' }}>{editingId ? 'Edit admin access' : 'Add an admin'}</Text>
            <Muted style={{ marginTop: 4 }}>The account must already exist. Choose which pages they can view or manage.</Muted>
            <Label>Account email</Label>
            <Input autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="name@example.com" />
            {ADMIN_PERMISSION_PAGES.map((adminPage) => {
              const permission = permissions[adminPage.key] || {};
              return (
                <View key={adminPage.key} style={{ borderTopWidth: 1, borderColor: C.border, paddingVertical: 8 }}>
                  <Text style={{ color: C.text, fontWeight: '700' }}>{adminPage.title}</Text>
                  <Muted>{adminPage.description}</Muted>
                  <View style={{ flexDirection: 'row', marginTop: 4 }}>
                    <Chip label="View" active={!!permission.can_view} onPress={() => toggle(adminPage.key, 'can_view')} />
                    <Chip label="Manage" active={!!permission.can_manage} onPress={() => toggle(adminPage.key, 'can_manage')} />
                  </View>
                </View>
              );
            })}
            <Btn title={editingId ? 'Save permissions' : 'Add admin'} onPress={save} disabled={!email.trim()} />
            {editingId && <Btn title="Cancel editing" kind="ghost" onPress={clearForm} />}
          </Card>
          <Text style={{ color: C.text, fontSize: 18, fontWeight: '800', margin: 14 }}>Admin accounts</Text>
          {rows.length === 0 && <Muted style={{ margin: 14 }}>No admin accounts found.</Muted>}
        </View>
      )}
      renderItem={({ item }) => (
        <Card>
          <Text style={{ color: C.text, fontWeight: '800' }}>{item.email}</Text>
          <Muted>{`${item.first_name || ''} ${item.last_name || ''}`.trim() || 'Admin account'}{item.is_super_admin ? ' · Super admin' : ''}</Muted>
          {!item.is_super_admin && <Muted style={{ marginTop: 4 }}>
            {Object.entries(item.permissions || {})
              .filter(([, permission]) => permission.can_view || permission.can_manage)
              .map(([pageKey, permission]) => `${pageKey.replace('_', ' ')}: ${permission.can_manage ? 'manage' : 'view'}`)
              .join(' · ') || 'No pages assigned'}
          </Muted>}
          {!item.is_super_admin && item.user_id !== session?.user?.id && (
            <View style={{ flexDirection: 'row' }}>
              <Btn style={{ flex: 1, margin: 2 }} kind="ghost" title="Edit access" onPress={() => edit(item)} />
              <Btn style={{ flex: 1, margin: 2 }} kind="danger" title="Remove" onPress={() => remove(item)} />
            </View>
          )}
        </Card>
      )}
      ListFooterComponent={<Pager page={page} setPage={setPage} hasMore={(page + 1) * PAGE_SIZE < rows.length} />}
    />
  );
}
