import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import { API_URL } from '../api/client'

interface User {
  id: string
  username: string
  email: string
  firstName: string
  lastName: string
  isActive: boolean
  createdAt: string
}

interface UsersResponse {
  statusCode: number
  data: {
    page: number
    pageSize: number
    totalCount: number
    data: User[]
  }
}

export default function SettingsPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [activeTab, setActiveTab] = useState<'school' | 'users' | 'roles' | 'audit'>('school')

  // School state
  const [schoolName, setSchoolName] = useState('')
  const [principalName, setPrincipalName] = useState('')
  const [schoolLoading, setSchoolLoading] = useState(true)
  const [schoolSaving, setSchoolSaving] = useState(false)

  // Users state
  const [users, setUsers] = useState<User[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [totalUsers, setTotalUsers] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [showAddUserForm, setShowAddUserForm] = useState(false)
  const [newUser, setNewUser] = useState({ username: '', email: '', firstName: '', lastName: '', password: '' })

  useEffect(() => {
    if (activeTab === 'school') fetchSchool()
    if (activeTab === 'users') fetchUsers()
  }, [activeTab])

  const fetchSchool = async () => {
    const authState = useAuthStore.getState()
    const schoolId = authState.user?.schoolId
    if (!schoolId) return

    setSchoolLoading(true)
    try {
      const response = await fetch(`${API_URL}/schools/${schoolId}`)
      const data = await response.json()
      if (data.data) {
        setSchoolName(data.data.name || '')
        setPrincipalName(data.data.principalName || '')
      }
    } catch (error) {
      console.error('Failed to fetch school:', error)
    } finally {
      setSchoolLoading(false)
    }
  }

  const fetchUsers = async () => {
    const authState = useAuthStore.getState()
    const schoolId = authState.user?.schoolId
    if (!schoolId) return

    setUsersLoading(true)
    try {
      // Call auth-service directly (gateway routing not working for /api/v1/users)
      const response = await fetch(`http://localhost:6001/api/users?page=${currentPage}&pageSize=20&schoolId=${schoolId}`)
      const data = (await response.json()) as UsersResponse
      if (data.data) {
        setUsers(data.data.data || [])
        setTotalUsers(data.data.totalCount || 0)
      }
    } catch (error) {
      console.error('Failed to fetch users:', error)
    } finally {
      setUsersLoading(false)
    }
  }

  const handleSaveSchool = async () => {
    const authState = useAuthStore.getState()
    const schoolId = authState.user?.schoolId
    if (!schoolId) return

    setSchoolSaving(true)
    try {
      const response = await fetch(`${API_URL}/schools/${schoolId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: schoolName, principalName })
      })
      if (response.ok) {
        alert('School settings saved successfully')
      } else {
        alert('Failed to save school settings')
      }
    } catch (error) {
      console.error('Save failed:', error)
      alert('Error saving settings')
    } finally {
      setSchoolSaving(false)
    }
  }

  const handleAddUser = async () => {
    const authState = useAuthStore.getState()
    const schoolId = authState.user?.schoolId
    if (!schoolId || !newUser.username || !newUser.email || !newUser.password) {
      alert('Please fill all fields')
      return
    }

    try {
      const response = await fetch(`http://localhost:6001/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newUser,
          schoolId,
          roleId: '4647dc07-237f-4f1e-acde-41f445ea7f4f'
        })
      })

      if (response.ok) {
        alert('User created successfully')
        setNewUser({ username: '', email: '', firstName: '', lastName: '', password: '' })
        setShowAddUserForm(false)
        fetchUsers()
      } else {
        const error = await response.json()
        alert(`Failed to create user: ${error.message}`)
      }
    } catch (error) {
      console.error('Failed to create user:', error)
      alert('Error creating user')
    }
  }

  const handleDeleteUser = async (userId: string) => {
    if (!confirm('Are you sure you want to delete this user?')) return

    const authState = useAuthStore.getState()
    const schoolId = authState.user?.schoolId
    if (!schoolId) return

    try {
      const response = await fetch(`http://localhost:6001/api/users/${userId}?schoolId=${schoolId}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        alert('User deleted successfully')
        fetchUsers()
      } else {
        const error = await response.json()
        alert(`Failed to delete user: ${error.message}`)
      }
    } catch (error) {
      console.error('Failed to delete user:', error)
      alert('Error deleting user')
    }
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <nav className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
            <button
              onClick={() => navigate('/')}
              className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto p-8">
        <div className="bg-white rounded-lg shadow">
          {/* Tabs */}
          <div className="flex border-b">
            <button
              onClick={() => setActiveTab('school')}
              className={`flex-1 px-6 py-4 text-center font-medium ${
                activeTab === 'school'
                  ? 'border-b-2 border-blue-600 text-blue-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              School Info
            </button>
            <button
              onClick={() => setActiveTab('users')}
              className={`flex-1 px-6 py-4 text-center font-medium ${
                activeTab === 'users'
                  ? 'border-b-2 border-blue-600 text-blue-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Users
            </button>
            <button
              onClick={() => setActiveTab('roles')}
              className={`flex-1 px-6 py-4 text-center font-medium ${
                activeTab === 'roles'
                  ? 'border-b-2 border-blue-600 text-blue-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Roles
            </button>
            <button
              onClick={() => setActiveTab('audit')}
              className={`flex-1 px-6 py-4 text-center font-medium ${
                activeTab === 'audit'
                  ? 'border-b-2 border-blue-600 text-blue-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Audit Log
            </button>
          </div>

          {/* Content */}
          <div className="p-6">
            {activeTab === 'school' && (
              <div>
                <h2 className="text-xl font-bold mb-4">School Information</h2>
                {schoolLoading ? (
                  <p className="text-gray-600">Loading...</p>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        School Name
                      </label>
                      <input
                        type="text"
                        value={schoolName}
                        onChange={(e) => setSchoolName(e.target.value)}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Principal Name
                      </label>
                      <input
                        type="text"
                        value={principalName}
                        onChange={(e) => setPrincipalName(e.target.value)}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <button
                      onClick={handleSaveSchool}
                      disabled={schoolSaving}
                      className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
                    >
                      {schoolSaving ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'users' && (
              <div>
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-bold">User Management</h2>
                  <button
                    onClick={() => setShowAddUserForm(!showAddUserForm)}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    {showAddUserForm ? 'Cancel' : 'Add User'}
                  </button>
                </div>

                {showAddUserForm && (
                  <div className="mb-6 p-4 border rounded bg-gray-50">
                    <h3 className="font-semibold mb-4">Create New User</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <input
                        type="text"
                        placeholder="Username"
                        value={newUser.username}
                        onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                        className="col-span-2 px-4 py-2 border border-gray-300 rounded-lg"
                      />
                      <input
                        type="email"
                        placeholder="Email"
                        value={newUser.email}
                        onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                        className="col-span-2 px-4 py-2 border border-gray-300 rounded-lg"
                      />
                      <input
                        type="text"
                        placeholder="First Name"
                        value={newUser.firstName}
                        onChange={(e) => setNewUser({ ...newUser, firstName: e.target.value })}
                        className="px-4 py-2 border border-gray-300 rounded-lg"
                      />
                      <input
                        type="text"
                        placeholder="Last Name"
                        value={newUser.lastName}
                        onChange={(e) => setNewUser({ ...newUser, lastName: e.target.value })}
                        className="px-4 py-2 border border-gray-300 rounded-lg"
                      />
                      <input
                        type="password"
                        placeholder="Password"
                        value={newUser.password}
                        onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                        className="col-span-2 px-4 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <button
                      onClick={handleAddUser}
                      className="mt-4 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                    >
                      Create User
                    </button>
                  </div>
                )}

                {usersLoading ? (
                  <p className="text-gray-600">Loading users...</p>
                ) : (
                  <div className="space-y-2">
                    {users.map((u) => (
                      <div key={u.id} className="p-4 border rounded flex justify-between items-center">
                        <div>
                          <p className="font-medium">{u.username}</p>
                          <p className="text-sm text-gray-600">{u.email}</p>
                          <p className="text-xs text-gray-500">{u.firstName} {u.lastName}</p>
                        </div>
                        <button
                          onClick={() => handleDeleteUser(u.id)}
                          className="text-red-600 hover:text-red-900"
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                    {users.length === 0 && <p className="text-gray-600">No users found</p>}
                  </div>
                )}
                <p className="text-xs text-gray-500 mt-4">Total users: {totalUsers}</p>
              </div>
            )}

            {activeTab === 'roles' && (
              <div>
                <h2 className="text-xl font-bold mb-4">Role Permissions</h2>
                <div className="space-y-4">
                  {['Super Admin', 'Principal', 'Teacher', 'Student', 'Parent'].map((role) => (
                    <div key={role} className="p-4 border rounded">
                      <h3 className="font-medium mb-2">{role}</h3>
                      <p className="text-sm text-gray-600">
                        Click to manage permissions for this role (Coming soon)
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'audit' && (
              <div>
                <h2 className="text-xl font-bold mb-4">Audit Log</h2>
                <div className="space-y-2">
                  <div className="p-4 border rounded text-sm">
                    <p className="font-medium">User admin logged in</p>
                    <p className="text-gray-600">2026-07-28 12:00:00 UTC</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
