import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import { API_URL } from '../api/client'

interface Student {
  id: string
  rollNumber: string
  firstName: string
  lastName: string
  currentClass: string
  email: string
  status: string
}

interface FormData {
  rollNumber: string
  firstName: string
  lastName: string
  email: string
  currentClass: string
  dateOfBirth: string
  status: string
}

export default function StudentsPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [students, setStudents] = useState<Student[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [formData, setFormData] = useState<FormData>({
    rollNumber: '',
    firstName: '',
    lastName: '',
    email: '',
    currentClass: '',
    dateOfBirth: '',
    status: 'Active',
  })

  const fetchStudents = async () => {
    const authState = useAuthStore.getState()
    const schoolId = authState.user?.schoolId
    if (!schoolId) return
    try {
      const response = await fetch(
        `${API_URL}/students?page=1&pageSize=100&schoolId=${schoolId}`,
        {
          headers: {
            'Authorization': `Bearer ${authState.accessToken}`
          }
        }
      )
      const data = await response.json()
      setStudents(data.data?.data || [])
    } catch (error) {
      console.error('Failed to fetch students:', error)
      setStudents([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchStudents()
  }, [user?.schoolId])

  const handleAddClick = () => {
    setIsEditing(false)
    setSelectedStudent(null)
    setFormData({
      rollNumber: '',
      firstName: '',
      lastName: '',
      email: '',
      currentClass: '',
      dateOfBirth: '',
      status: 'Active',
    })
    setShowModal(true)
  }

  const handleEditClick = (student: Student) => {
    setIsEditing(true)
    setSelectedStudent(student)
    setFormData({
      rollNumber: student.rollNumber,
      firstName: student.firstName,
      lastName: student.lastName,
      email: student.email,
      currentClass: student.currentClass,
      dateOfBirth: '',
      status: student.status,
    })
    setShowModal(true)
  }

  const handleDeleteClick = async (studentId: string) => {
    if (!window.confirm('Are you sure you want to delete this student?')) return
    const authState = useAuthStore.getState()
    const schoolId = authState.user?.schoolId
    if (!schoolId) return

    try {
      const response = await fetch(
        `${API_URL}/students/${studentId}?schoolId=${schoolId}`,
        {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${authState.accessToken}`
          }
        }
      )
      if (response.ok) {
        alert('Student deleted successfully')
        fetchStudents()
      } else {
        alert('Failed to delete student')
      }
    } catch (error) {
      console.error('Delete failed:', error)
      alert('Error deleting student')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)

    const authState = useAuthStore.getState()
    const schoolId = authState.user?.schoolId
    if (!schoolId) return

    try {
      if (isEditing && selectedStudent) {
        const response = await fetch(
          `${API_URL}/students/${selectedStudent.id}`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${authState.accessToken}`
            },
            body: JSON.stringify({
              id: selectedStudent.id,
              schoolId,
              ...formData,
            })
          }
        )
        if (response.ok) {
          alert('Student updated successfully')
          setShowModal(false)
          fetchStudents()
        } else {
          alert('Failed to update student')
        }
      } else {
        const response = await fetch(
          `${API_URL}/students`,
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
          alert('Student created successfully')
          setShowModal(false)
          fetchStudents()
        } else {
          alert('Failed to create student')
        }
      }
    } catch (error) {
      console.error('Submit failed:', error)
      alert('Error saving student')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <nav className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold text-gray-900">Students</h1>
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
              <h2 className="text-xl font-bold">Student List ({students.length})</h2>
              <button
                onClick={handleAddClick}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Add Student
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            {students.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
                No students found. Click "Add Student" to create one.
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                      Roll Number
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                      Class
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                      Email
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
                  {students.map((student) => (
                    <tr key={student.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm">{student.rollNumber}</td>
                      <td className="px-6 py-4 text-sm font-medium">
                        {student.firstName} {student.lastName}
                      </td>
                      <td className="px-6 py-4 text-sm">{student.currentClass}</td>
                      <td className="px-6 py-4 text-sm">{student.email}</td>
                      <td className="px-6 py-4 text-sm">
                        <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-semibold">
                          {student.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <button
                          onClick={() => handleEditClick(student)}
                          className="text-blue-600 hover:text-blue-900 mr-4"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteClick(student.id)}
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
              {isEditing ? 'Edit Student' : 'Add Student'}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-900">Roll Number *</label>
                <input
                  type="text"
                  value={formData.rollNumber}
                  onChange={(e) => setFormData({ ...formData, rollNumber: e.target.value })}
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
                <label className="block text-sm font-medium text-gray-900">Class *</label>
                <input
                  type="text"
                  value={formData.currentClass}
                  onChange={(e) => setFormData({ ...formData, currentClass: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-900">Date of Birth *</label>
                <input
                  type="date"
                  value={formData.dateOfBirth}
                  onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
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
                    <option>Graduated</option>
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
