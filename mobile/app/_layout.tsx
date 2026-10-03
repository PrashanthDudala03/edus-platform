import { useEffect } from 'react'
import { Stack } from 'expo-router'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { QueryClientProvider } from '@tanstack/react-query'
import { OfflineBanner } from '@/components/QueryView'
import { EmptyState } from '@/components/ui'
import { configurationProblem, queryClient, session } from '@/services'
import { color } from '@/theme/tokens'

/** The root of the app: providers, the one-time session check, and the offline notice over every screen. */
export default function RootLayout() {
  useEffect(() => { if (!configurationProblem) session.restore() }, [])
  return <SafeAreaProvider><QueryClientProvider client={queryClient}><StatusBar style="dark" />
    {configurationProblem
      ? <SafeAreaView style={{ flex: 1, justifyContent: 'center', backgroundColor: color.background }}><EmptyState icon="construct-outline" title="EduOS is not set up on this build" message={configurationProblem} /></SafeAreaView>
      : <><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.background } }} /><OfflineBanner /></>}
  </QueryClientProvider></SafeAreaProvider>
}
