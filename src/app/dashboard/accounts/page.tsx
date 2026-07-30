'use client';
import { useEffect, useState, useCallback } from 'react';
import { passwordInputType } from '@/lib/password-visibility';
import { Button, LoadingState, PageHeader, PageStack } from '@/components/ui/dashboard';

interface User {
  id: string;
  username: string;
  name: string;
  role: string;
  last_active: string | null;
  created_at: string;
  department_id: string | null;
  department_name: string | null;
}

interface Department { id: string; name: string; permitted_features: string[]; }

interface UserForm {
  username: string;
  name: string;
  password: string;
  role: string;
  departmentId: string;
}

const initialForm: UserForm = { username: '', name: '', password: '', role: 'member', departmentId: '' };

export default function AccountsPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentName, setDepartmentName] = useState('');
  const [departmentFeatures, setDepartmentFeatures] = useState<string[]>(['social-post', 'video-script', 'event-plan']);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [form, setForm] = useState<UserForm>(initialForm);
  const [showAddPassword, setShowAddPassword] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [saving, setSaving] = useState(false);

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/users');
      if (!res.ok) {
        if (res.status === 403) {
          showToast('Admin access required', 'error');
        }
        return;
      }
      const data = await res.json();
      setUsers(data.users || []);
    } catch {
      showToast('Failed to load users', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const fetchDepartments = useCallback(async () => {
    const response = await fetch('/api/admin/departments');
    if (response.ok) setDepartments((await response.json()).departments || []);
  }, []);

  useEffect(() => {
    // Get current user info
    fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'check' }),
    }).then(async res => {
      const data = await res.json();
      if (data.authenticated && data.user) {
        setCurrentUserId(data.user.id);
      }
    });

    fetchUsers();
    fetchDepartments();
  }, [fetchUsers, fetchDepartments]);

  const handleAdd = async () => {
    if (!form.username || !form.name || !form.password || (form.role === 'member' && !form.departmentId)) {
      showToast('Please fill in all required fields', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, departmentId: form.departmentId || null }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(`User "${data.user.username}" created successfully`, 'success');
        setShowAddModal(false);
        setForm(initialForm);
        fetchUsers();
      } else {
        showToast(data.error || 'Failed to create user', 'error');
      }
    } catch {
      showToast('Failed to create user', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async () => {
    if (!editTarget) return;
    if (!form.name) {
      showToast('Name is required', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { id: editTarget.id };
      if (form.username !== editTarget.username) payload.username = form.username;
      if (form.name !== editTarget.name) payload.name = form.name;
      if (form.password) payload.password = form.password;
      if (form.role !== editTarget.role) payload.role = form.role;
      if (form.departmentId !== (editTarget.department_id || '')) payload.departmentId = form.departmentId || null;

      if (Object.keys(payload).length === 1) {
        showToast('No changes to save', 'error');
        setSaving(false);
        return;
      }

      const res = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(`User "${data.user.username}" updated`, 'success');
        setShowEditModal(false);
        setEditTarget(null);
        setForm(initialForm);
        fetchUsers();
      } else {
        showToast(data.error || 'Failed to update user', 'error');
      }
    } catch {
      showToast('Failed to update user', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users?id=${deleteTarget.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (res.ok) {
        showToast(`User "${deleteTarget.username}" deleted`, 'success');
        setShowDeleteModal(false);
        setDeleteTarget(null);
        fetchUsers();
      } else {
        showToast(data.error || 'Failed to delete user', 'error');
      }
    } catch {
      showToast('Failed to delete user', 'error');
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (user: User) => {
    setEditTarget(user);
    setForm({ username: user.username, name: user.name, password: '', role: user.role, departmentId: user.department_id || '' });
    setShowEditModal(true);
  };

  const openDelete = (user: User) => {
    setDeleteTarget(user);
    setShowDeleteModal(true);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  const totalUsers = users.length;
  const adminUsers = users.filter(u => u.role === 'admin').length;
  const activeUsers = users.filter(u => u.last_active).length;
  const createDepartment = async () => {
    if (!departmentName.trim()) return showToast('Department name is required', 'error');
    const response = await fetch('/api/admin/departments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: departmentName, features: departmentFeatures }) });
    const data = await response.json();
    if (!response.ok) return showToast(data.error || 'Failed to create department', 'error');
    setDepartmentName(''); setDepartmentFeatures(['social-post', 'video-script', 'event-plan']); fetchDepartments(); showToast('Department created', 'success');
  };
  const toggleDepartmentFeature = async (department: Department, feature: string) => {
    const features = department.permitted_features.includes(feature) ? department.permitted_features.filter(value => value !== feature) : [...department.permitted_features, feature];
    const response = await fetch('/api/admin/departments', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: department.id, features }) });
    if (!response.ok) return showToast('Failed to update department', 'error');
    fetchDepartments();
  };

  if (loading) {
    return <LoadingState label="Loading accounts" />;
  }

  return (
    <PageStack>
      <PageHeader eyebrow="Administration / Access" title="Accounts" description="Create, edit, and manage team access, roles, and departments." actions={<Button variant="primary" onClick={() => { setForm(initialForm); setShowAddPassword(false); setShowAddModal(true); }}>Add user</Button>} />

      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-5 py-3 rounded-lg shadow-lg text-sm font-medium transition-all ${
          toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.type === 'success' ? '✅ ' : '❌ '}{toast.message}
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700/50">
          <div className="text-3xl mb-2">👥</div>
          <div className="text-2xl font-bold text-white">{totalUsers}</div>
          <div className="text-sm text-gray-400">Total Users</div>
        </div>
        <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700/50">
          <div className="text-3xl mb-2">🔒</div>
          <div className="text-2xl font-bold text-white">{adminUsers}</div>
          <div className="text-sm text-gray-400">Admin Users</div>
        </div>
        <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700/50">
          <div className="text-3xl mb-2">🟢</div>
          <div className="text-2xl font-bold text-white">{activeUsers}</div>
          <div className="text-sm text-gray-400">Active (logged in)</div>
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-700/50">
                <th className="text-left p-4 text-xs text-gray-500 uppercase tracking-wider font-medium">Username</th>
                <th className="text-left p-4 text-xs text-gray-500 uppercase tracking-wider font-medium">Name</th>
                <th className="text-left p-4 text-xs text-gray-500 uppercase tracking-wider font-medium">Role</th>
                <th className="text-left p-4 text-xs text-gray-500 uppercase tracking-wider font-medium">Department</th>
                <th className="text-left p-4 text-xs text-gray-500 uppercase tracking-wider font-medium">Created</th>
                <th className="text-left p-4 text-xs text-gray-500 uppercase tracking-wider font-medium">Last Active</th>
                <th className="text-right p-4 text-xs text-gray-500 uppercase tracking-wider font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => (
                <tr key={user.id} className="border-b border-gray-800/50 hover:bg-gray-700/20 transition-colors">
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-xs font-medium text-white">
                        {user.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <span className="text-white text-sm font-medium">{user.username}</span>
                        {user.id === currentUserId && (
                          <span className="ml-2 text-[10px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded-full">You</span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="p-4 text-sm text-gray-300">{user.name}</td>
                  <td className="p-4">
                    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                      user.role === 'admin'
                        ? 'bg-purple-500/20 text-purple-400'
                        : 'bg-gray-600/30 text-gray-300'
                    }`}>
                      {user.role === 'admin' && <span>🔒</span>}
                      {user.role}
                    </span>
                  </td>
                  <td className="p-4 text-sm text-gray-300">{user.role === 'admin' ? 'All access' : user.department_name || '—'}</td>
                  <td className="p-4 text-sm text-gray-400">{formatDate(user.created_at)}</td>
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${user.last_active ? 'bg-green-400' : 'bg-gray-600'}`}></span>
                      <span className="text-sm text-gray-400">
                        {user.last_active ? formatDate(user.last_active) : 'Never'}
                      </span>
                    </div>
                  </td>
                  <td className="p-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => openEdit(user)}
                        className="px-3 py-1.5 bg-gray-700/50 hover:bg-gray-600/50 text-gray-300 text-xs font-medium rounded-lg transition-colors"
                      >
                        ✏️ Edit
                      </button>
                      {user.id !== currentUserId && (
                        <button
                          onClick={() => openDelete(user)}
                          className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 text-xs font-medium rounded-lg transition-colors"
                        >
                          🗑️ Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-gray-500">No users found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 p-5">
        <h2 className="text-lg font-semibold text-white">Departments</h2>
        <p className="text-sm text-gray-400 mt-1">Choose which generation modules each department can use.</p>
        <div className="flex flex-wrap gap-3 mt-4">
          <input value={departmentName} onChange={e => setDepartmentName(e.target.value)} placeholder="Department name" className="bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white" />
          {['social-post', 'video-script', 'event-plan'].map(feature => <label key={feature} className="text-sm text-gray-300 flex items-center gap-1"><input type="checkbox" checked={departmentFeatures.includes(feature)} onChange={() => setDepartmentFeatures(current => current.includes(feature) ? current.filter(value => value !== feature) : [...current, feature])} /> {feature}</label>)}
          <button onClick={createDepartment} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg">Create department</button>
        </div>
        <div className="mt-4 text-sm text-gray-300 space-y-3">{departments.map(department => <div key={department.id} className="flex flex-wrap items-center gap-3"><span className="font-medium min-w-28">{department.name}</span>{['social-post', 'video-script', 'event-plan'].map(feature => <label key={feature} className="flex items-center gap-1 text-gray-400"><input type="checkbox" checked={department.permitted_features.includes(feature)} onChange={() => toggleDepartmentFeature(department, feature)} /> {feature}</label>)}</div>)}</div>
      </div>

      {/* Add User Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-40" onClick={() => setShowAddModal(false)}>
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-white">Add New User</h2>
              <button onClick={() => setShowAddModal(false)} className="text-gray-500 hover:text-white text-xl">&times;</button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1.5">Username *</label>
                <input
                  type="text"
                  value={form.username}
                  onChange={e => setForm(p => ({ ...p, username: e.target.value }))}
                  className="w-full bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                  placeholder="e.g. newmember"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1.5">Full Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  className="w-full bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                  placeholder="e.g. New Member"
                />
              </div>
              {form.role === 'member' && <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1.5">Department *</label>
                <select value={form.departmentId} onChange={e => setForm(p => ({ ...p, departmentId: e.target.value }))} className="w-full bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white"><option value="">Select department</option>{departments.map(department => <option key={department.id} value={department.id}>{department.name}</option>)}</select>
              </div>}
              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1.5">Password *</label>
                <div className="relative">
                  <input
                    type={passwordInputType(showAddPassword)}
                    value={form.password}
                    onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                    className="w-full bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 pr-11 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                    placeholder="Min 6 characters"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAddPassword(visible => !visible)}
                    aria-label={showAddPassword ? 'Hide password' : 'Show password'}
                    title={showAddPassword ? 'Hide password' : 'Show password'}
                    className="absolute inset-y-0 right-0 px-3 text-gray-400 hover:text-white transition-colors"
                  >
                    {showAddPassword ? '🙈' : '👁️'}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1.5">Role</label>
                <select
                  value={form.role}
                  onChange={e => setForm(p => ({ ...p, role: e.target.value }))}
                  className="w-full bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-gray-700/50">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                disabled={saving}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
              >
                {saving ? (
                  <><span className="animate-spin h-3 w-3 border-b-2 border-white rounded-full"></span> Creating...</>
                ) : 'Create User'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {showEditModal && editTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-40" onClick={() => setShowEditModal(false)}>
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-white">Edit User</h2>
              <button onClick={() => setShowEditModal(false)} className="text-gray-500 hover:text-white text-xl">&times;</button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1.5">Username</label>
                <input
                  type="text"
                  value={form.username}
                  onChange={e => setForm(p => ({ ...p, username: e.target.value }))}
                  className="w-full bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1.5">Full Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  className="w-full bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1.5">New Password (leave blank to keep current)</label>
                <input
                  type="password"
                  value={form.password}
                  onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                  className="w-full bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                  placeholder="Leave blank to keep current"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1.5">Role</label>
                <select
                  value={form.role}
                  onChange={e => setForm(p => ({ ...p, role: e.target.value }))}
                  className="w-full bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              {form.role === 'member' && <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1.5">Department *</label>
                <select value={form.departmentId} onChange={e => setForm(p => ({ ...p, departmentId: e.target.value }))} className="w-full bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white"><option value="">Select department</option>{departments.map(department => <option key={department.id} value={department.id}>{department.name}</option>)}</select>
              </div>}
            </div>

            <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-gray-700/50">
              <button
                onClick={() => setShowEditModal(false)}
                className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleEdit}
                disabled={saving}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
              >
                {saving ? (
                  <><span className="animate-spin h-3 w-3 border-b-2 border-white rounded-full"></span> Saving...</>
                ) : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && deleteTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-40" onClick={() => setShowDeleteModal(false)}>
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="text-center mb-6">
              <div className="text-4xl mb-3">⚠️</div>
              <h2 className="text-lg font-semibold text-white">Delete User</h2>
              <p className="text-sm text-gray-400 mt-2">
                Are you sure you want to delete <strong className="text-white">{deleteTarget.name}</strong> (@{deleteTarget.username})?
              </p>
              <p className="text-xs text-red-400 mt-2">
                This will permanently delete the user and all their associated data (tasks, tokens, assets, etc.).
              </p>
            </div>

            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={saving}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
              >
                {saving ? (
                  <><span className="animate-spin h-3 w-3 border-b-2 border-white rounded-full"></span> Deleting...</>
                ) : 'Yes, Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageStack>
  );
}
