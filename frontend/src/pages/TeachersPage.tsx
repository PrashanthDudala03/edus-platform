import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import { API_URL } from '../api/client'

interface Teacher {
  id: string
  employeeCode: string
  firstName: string
  lastName: string
  email: string
  department?: string
  status: string
}

interface FormData {
  employeeCode: string
  firstName: string
  lastName: string
  email: string
  phoneNumber: string
  department: string
  status: string
}

export default function TeachersPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [selectedTeacher, setSelectedTeacher] = useState<Teacher | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [formData, setFormData] = useState<FormData>({
    employeeCode: '',
    firstName: '',
    lastName: '',
    email: '',
    phoneNumber: '',
    department: '',
    status: 'Active',
  })

  const fetchTeachers = async () => {
    const authState = useAuthStore.getState()
    const schoolId = authState.user?.schoolId
    if (!schoolId) return
    try {
      const response = await fetch(
        `${API_URL}/teachers?page=1&pageSize=100&schoolId=${schoolId}`,
        {
          headers: {
            'Authorization': `Bearer ${authState.accessToken}`
          }
        }
      )
      const data = await response.json()
      setTeachers(data.data?.data || [])
    } catch (error) {
      console.error('Failed to fetch teachers:', error)
      setTeachers([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTeachers()
  }, [user?.schoolId])

  const handleAddClick = () => {
    setIsEditing(false)
    setSelectedTeacher(null)
    setFormData({
      employeeCode: '',
      firstName: '',
      lastName: '',
      email: '',
      phoneNumber: '',
      department: '',
      status: 'Active',
    })
    setShowModal(true)
  }

  const handleEditClick = (teacher: Teacher) => {
    setIsEditing(true)
    setSelectedTeacher(teacher)
    setFormData({
      employeeCode: teacher.employeeCode,
      firstName: teacher.firstName,
      lastName: teacher.lastName,
      email: teacher.email,
      phoneNumber: '',
      department: teacher.department || '',
      status: teacher.status,
    })
    setShowModal(true)
  }

  const handleDeleteClick = async (teacherId: string) => {
    if (!window.confirm('Are you sure you want to delete this teacher?')) return
    const authState = useAuthStore.getState()
    const schoolId = authState.user?.schoolId
    if (!schoolId) return

    try {
      const response = await fetch(
        `${API_URL}/teachers/${teacherId}?schoolId=${schoolId}`,
        {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${authState.accessToken}`
          }
        }
      )
      if (response.ok) {
        alert('Teacher deleted successfully')
        fetchTeachers()
      } else {
        alert('Failed to delete teacher')
      }
    } catch (error) {
      console.error('Delete failed:', error)
      alert('Error deleting teacher')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)

    const authState = useAuthStore.getState()
    const schoolId = authState.user?.schoolId
    if (!schoolId) return

    try {
      if (isEditing && selectedTeacher) {
        const response = await fetch(
          `${API_URL}/teachers/${selectedTeacher.id}`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${authState.accessToken}`
            },
            body: JSON.stringify({
              id: selectedTeacher.id,
              schoolId,
              ...formData,
            })
          }
        )
        if (response.ok) {
          alert('Teacher updated successfully')
          setShowModal(false)
          fetchTeachers()
        } else {
          alert('Failed to update teacher')
        }
      } else {
        const response = await fetch(
          `${API_URL}/teachers`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${authState.accessToken}`
            },
            body: JSON.stringify({
              schoolId,
              ...formData,
            })
          }
        )
        if (response.ok) {
          alert('Teacher created successfully')
          setShowModal(false)
          fetchTeachers()
        } else {
          alert('Failed to create teacher')
        }
      }
    } catch (error) {
      console.error('Submit failed:', error)
      alert('Error saving teacher')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <nav className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold text-gray-900">Teachers</h1>
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
          <div className="p-6 border-b">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-bold">Teacher List ({teachers.length})</h2>
              <button
                onClick={handleAddClick}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Add Teacher
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            {teachers.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
                No teachers found. Click "Add Teacher" to create one.
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                      Employee Code
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                      Email
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                      Department
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {teachers.map((teacher) => (
                    <tr key={teacher.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm">{teacher.employeeCode}</td>
                      <td className="px-6 py-4 text-sm font-medium">
                        {teacher.firstName} {teacher.lastName}
                      </td>
                      <td className="px-6 py-4 text-sm">{teacher.email}</td>
                      <td className="px-6 py-4 text-sm">{teacher.department || '-'}</td>
                      <td className="px-6 py-4 text-sm">
                        <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-semibold">
                          {teacher.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <button
                          onClick={() => handleEditClick(teacher)}
                          className="text-blue-600 hover:text-blue-900 mr-4"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteClick(teacher.id)}
                          className="text-red-600 hover:text-red-900"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-lg max-w-md w-full p-6">
            <h3 className="text-lg font-bold mb-4">
              {isEditing ? 'Edit Teacher' : 'Add Teacher'}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-900">Employee Code *</label>
                <input
                  type="text"
                  value={formData.employeeCode}
                  onChange={(e) => setFormData({ ...formData, employeeCode: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-900">First Name *</label>
                <input
                  type="text"
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-900">Last Name *</label>
                <input
                  type="text"
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-900">Email *</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-900">Phone Number</label>
                <input
                  type="tel"
                  value={formData.phoneNumber}
                  onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-900">Department</label>
                <input
                  type="text"
                  value={formData.department}
                  onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              {isEditing && (
                <div>
                  <label className="block text-sm font-medium text-gray-900">Status</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option>Active</option>
                    <option>Inactive</option>
                    <option>Retired</option>
                  </select>
                </div>
              )}
              <div className="flex gap-2 justify-end pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-gray-700 border border-gray-300 rounded hover:bg-gray-50"
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
                  disabled={submitting}
                >
                  {submitting ? 'Saving...' : isEditing ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
