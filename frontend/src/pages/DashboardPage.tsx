import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import { API_URL } from '../api/client'

export default function DashboardPage() {
  const navigate = useNavigate()
  const { user, clearAuth, schoolId } = useAuthStore()
  const [studentCount, setStudentCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchStudentCount = async () => {
      const authState = useAuthStore.getState()
      const schoolId = authState.user?.schoolId
      if (!schoolId) return
      try {
        const response = await fetch(
          `${API_URL}/students/count?schoolId=${schoolId}`,
          {
            headers: {
              'Authorization': `Bearer ${authState.accessToken}`
            }
          }
        )
        const data = await response.json()
        setStudentCount(data.data?.count || 0)
      } catch (error) {
        console.error('Failed to fetch student count:', error)
        setStudentCount(0)
      } finally {
        setLoading(false)
      }
    }
    fetchStudentCount()
  }, [user?.schoolId])

  const handleLogout = () => {
    clearAuth()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Navbar */}
      <nav className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold text-gray-900">EduOS Dashboard</h1>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600">{user?.firstName} {user?.lastName}</span>
              <button
                onClick={handleLogout}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </nav>

      <div className="flex">
        {/* Sidebar */}
        <aside className="w-64 bg-gray-800 text-white min-h-screen">
          <div className="p-4">
            <nav className="space-y-2">
              <NavLink label="Dashboard" path="/" onClick={() => {}} isActive />
              <NavLink label="Students" path="/students" onClick={() => navigate('/students')} />
              <NavLink label="Teachers" path="/teachers" onClick={() => navigate('/teachers')} />
              <NavLink label="Parents" path="/parents" onClick={() => navigate('/parents')} />
              <NavLink label="Settings" path="/settings" onClick={() => navigate('/settings')} />
            </nav>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <Card title="Total Students" value={loading ? "..." : String(studentCount || 0)} color="blue" />
            <Card title="Total Teachers" value="89" color="green" />
            <Card title="Total Parents" value="2,350" color="purple" />
            <Card title="Active Classes" value="12" color="orange" />
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold mb-4">Welcome to EduOS</h2>
            <p className="text-gray-600 mb-4">
              Your school management system is ready to use. Select a section from the menu to get started.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <QuickAction
                title="Manage Students"
                description="Add, edit, or view students"
                onClick={() => navigate('/students')}
              />
              <QuickAction
                title="Manage Teachers"
                description="Add, edit, or view teachers"
                onClick={() => navigate('/teachers')}
              />
              <QuickAction
                title="Manage Parents"
                description="Add, edit, or view parents"
                onClick={() => navigate('/parents')}
              />
              <QuickAction
                title="System Settings"
                description="Configure school settings"
                onClick={() => navigate('/settings')}
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

function NavLink({
  label,
  path,
  onClick,
  isActive = false,
}: {
  label: string
  path: string
  onClick: () => void
  isActive?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-2 rounded ${
        isActive ? 'bg-gray-700' : 'hover:bg-gray-700'
      }`}
    >
      {label}
    </button>
  )
}

function Card({
  title,
  value,
  color,
}: {
  title: string
  value: string
  color: 'blue' | 'green' | 'purple' | 'orange'
}) {
  const colorClasses = {
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-green-50 text-green-700',
    purple: 'bg-purple-50 text-purple-700',
    orange: 'bg-orange-50 text-orange-700',
  }

  return (
    <div className={`${colorClasses[color]} rounded-lg p-6`}>
      <p className="text-sm font-medium">{title}</p>
      <p className="text-3xl font-bold mt-2">{value}</p>
    </div>
  )
}

function QuickAction({
  title,
  description,
  onClick,
}: {
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="p-4 border border-gray-200 rounded-lg hover:shadow-md hover:border-gray-300 transition text-left"
    >
      <h3 className="font-semibold text-gray-900">{title}</h3>
      <p className="text-sm text-gray-600 mt-1">{description}</p>
    </button>
  )
}
