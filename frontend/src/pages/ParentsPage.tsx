import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import { API_URL } from '../api/client'

interface Parent {
  id: string
  firstName: string
  lastName: string
  email: string
  phoneNumber: string
}

interface FormData {
  firstName: string
  lastName: string
  email: string
  phoneNumber: string
}

export default function ParentsPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [parents, setParents] = useState<Parent[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [selectedParent, setSelectedParent] = useState<Parent | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [formData, setFormData] = useState<FormData>({
    firstName: '',
    lastName: '',
    email: '',
    phoneNumber: '',
  })

  const fetchParents = async () => {
    const authState = useAuthStore.getState()
    const schoolId = authState.user?.schoolId
    if (!schoolId) return
    try {
      const response = await fetch(
        `${API_URL}/parents?page=1&pageSize=100&schoolId=${schoolId}`,
        {
          headers: {
            'Authorization': `Bearer ${authState.accessToken}`
          }
        }
      )
      const data = await response.json()
      setParents(data.data?.data || [])
    } catch (error) {
      console.error('Failed to fetch parents:', error)
      setParents([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchParents()
  }, [user?.schoolId])

  const handleAddClick = () => {
    setIsEditing(false)
    setSelectedParent(null)
    setFormData({
      firstName: '',
      lastName: '',
      email: '',
      phoneNumber: '',
    })
    setShowModal(true)
  }

  const handleEditClick = (parent: Parent) => {
    setIsEditing(true)
    setSelectedParent(parent)
    setFormData({
      firstName: parent.firstName,
      lastName: parent.lastName,
      email: parent.email,
      phoneNumber: parent.phoneNumber,
    })
    setShowModal(true)
  }

  const handleDeleteClick = async (parentId: string) => {
    if (!window.confirm('Are you sure you want to delete this parent?')) return
    const authState = useAuthStore.getState()
    const schoolId = authState.user?.schoolId
    if (!schoolId) return

    try {
      const response = await fetch(
        `${API_URL}/parents/${parentId}?schoolId=${schoolId}`,
        {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${authState.accessToken}`
          }
        }
      )
      if (response.ok) {
        alert('Parent deleted successfully')
        fetchParents()
      } else {
        alert('Failed to delete parent')
      }
    } catch (error) {
      console.error('Delete failed:', error)
      alert('Error deleting parent')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)

    const authState = useAuthStore.getState()
    const schoolId = authState.user?.schoolId
    if (!schoolId) return

    try {
      if (isEditing && selectedParent) {
        const response = await fetch(
          `${API_URL}/parents/${selectedParent.id}`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${authState.accessToken}`
            },
            body: JSON.stringify({
              id: selectedParent.id,
              schoolId,
              ...formData,
            })
          }
        )
        if (response.ok) {
          alert('Parent updated successfully')
          setShowModal(false)
          fetchParents()
        } else {
          alert('Failed to update parent')
        }
      } else {
        const response = await fetch(
          `${API_URL}/parents`,
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
          alert('Parent created successfully')
          setShowModal(false)
          fetchParents()
        } else {
          alert('Failed to create parent')
        }
      }
    } catch (error) {
      console.error('Submit failed:', error)
      alert('Error saving parent')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <nav className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold text-gray-900">Parents</h1>
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
              <h2 className="text-xl font-bold">Parent List ({parents.length})</h2>
              <button
                onClick={handleAddClick}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Add Parent
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            {parents.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
                No parents found. Click "Add Parent" to create one.
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                      Email
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                      Phone
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {parents.map((parent) => (
                    <tr key={parent.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm font-medium">
                        {parent.firstName} {parent.lastName}
                      </td>
                      <td className="px-6 py-4 text-sm">{parent.email}</td>
                      <td className="px-6 py-4 text-sm">{parent.phoneNumber}</td>
                      <td className="px-6 py-4 text-sm">
                        <button
                          onClick={() => handleEditClick(parent)}
                          className="text-blue-600 hover:text-blue-900 mr-4"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteClick(parent.id)}
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
              {isEditing ? 'Edit Parent' : 'Add Parent'}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
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
                <label className="block text-sm font-medium text-gray-900">Phone Number *</label>
                <input
                  type="tel"
                  value={formData.phoneNumber}
                  onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
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
