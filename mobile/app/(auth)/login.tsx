import { useRef, useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type TextInput } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Redirect, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod'
import { normalizeError, type SchoolChoice } from '@/api/errors'
import { BUILD_STAMP } from '@/build'
import { Group, LinkText, ListItem, Sheet } from '@/components/blocks'
import { AppText, Avatar, Button, Notice, TextField } from '@/components/ui'
import { session, useSession } from '@/services'
import { color, radius, space } from '@/theme/tokens'
import { initials } from '@/utils/format'

// One sign-in for every role. What opens afterwards follows the verified account, not a choice made here.
// When a sign-in name belongs to several schools, EduOS lists them and the person picks one by name; a school id is
// never typed or shown. A school code is only for asking a school for an account (Create account), never for signing in.
const schema = z.object({
  username: z.string().trim().min(1, 'Enter your email or username.').max(255, 'That is too long.'),
  password: z.string().min(1, 'Enter your password.').max(200, 'That is too long.'),
})
type Form = z.infer<typeof schema>

export default function LoginScreen() {
  const router = useRouter(), { status, notice, restorePending, welcomePending } = useSession()
  const { control, handleSubmit, getValues, formState: { errors, isSubmitting } } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { username: '', password: '' } })
  const [failure, setFailure] = useState(''), [retrying, setRetrying] = useState(false), [schools, setSchools] = useState<SchoolChoice[] | null>(null), [choosing, setChoosing] = useState(''), password = useRef<TextInput>(null)
  if (status === 'signed-in') return <Redirect href={welcomePending ? '/welcome' : '/home'} />

  const submit = handleSubmit(async values => {
    setFailure('')
    try { await session.signIn(values) } catch (error) { const problem = normalizeError(error); if (problem.schools?.length) setSchools(problem.schools); else setFailure(problem.message) }
  })
  const choose = async (school: SchoolChoice) => {
    setChoosing(school.id); setFailure('')
    try { await session.signIn({ ...getValues(), schoolId: school.id }) } catch (error) { setSchools(null); setFailure(normalizeError(error).message) } finally { setChoosing('') }
  }
  const retry = async () => { setRetrying(true); try { await session.restore() } finally { setRetrying(false) } }

  return <SafeAreaView style={styles.page}><KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View style={styles.brand}><View style={styles.mark}><Ionicons name="school" size={30} color={color.onPrimary} /></View>
        <AppText variant="display" accessibilityRole="header">EduOS</AppText><AppText tone="muted" style={styles.center}>Your school, in your pocket.</AppText></View>
      <View style={styles.card}>
        <AppText variant="title">Sign in</AppText><AppText tone="muted">Use the account your school gave you.</AppText>
        {!!notice && !failure && <Notice tone="warning" message={notice} action={restorePending ? <Button label="Try again" variant="secondary" icon="refresh" loading={retrying} onPress={retry} style={styles.retry} /> : undefined} />}
        {!!failure && <Notice tone="danger" message={failure} />}
        <Controller control={control} name="username" render={({ field: { onChange, onBlur, value } }) => <TextField label="Email or username" value={value} onChangeText={onChange} onBlur={onBlur} error={errors.username?.message}
          autoCapitalize="none" autoCorrect={false} autoComplete="username" textContentType="username" keyboardType="email-address" returnKeyType="next" placeholder="you@school.edu" onSubmitEditing={() => password.current?.focus()} submitBehavior="submit" />} />
        <Controller control={control} name="password" render={({ field: { onChange, onBlur, value } }) => <TextField ref={password} label="Password" secure value={value} onChangeText={onChange} onBlur={onBlur} error={errors.password?.message}
          autoCapitalize="none" autoCorrect={false} autoComplete="current-password" textContentType="password" returnKeyType="go" placeholder="Enter your password" onSubmitEditing={submit} />} />
        <Button label={isSubmitting ? 'Signing in…' : 'Sign in'} icon="arrow-forward" loading={isSubmitting} onPress={submit} />
        <View style={styles.links}><LinkText label="Forgot password?" onPress={() => router.push('/recover')} /><LinkText label="Create account" onPress={() => router.push('/signup')} /></View>
      </View>
      <View style={styles.help}><Ionicons name="shield-checkmark-outline" size={18} color={color.textMuted} /><AppText variant="caption" tone="muted" style={styles.flex}>New accounts and password resets are confirmed by your school administrator.</AppText></View>
      {!!BUILD_STAMP && <AppText variant="caption" tone="faint" style={styles.center}>{BUILD_STAMP}</AppText>}
    </ScrollView></KeyboardAvoidingView>
    <Sheet visible={!!schools} title="Choose your school" onClose={() => { if (!choosing) setSchools(null) }}>
      <AppText tone="muted">Your sign-in is used at more than one school. Pick the one you want to open.</AppText>
      <Group>{(schools ?? []).map((school, i, all) => <ListItem key={school.id} leading={<Avatar label={initials(school.name) || 'S'} background={color.primary} foreground={color.onPrimary} />} title={school.name}
        subtitle={choosing === school.id ? 'Signing in…' : undefined} onPress={choosing ? undefined : () => { choose(school) }} last={i === all.length - 1} />)}</Group>
    </Sheet></SafeAreaView>
}
const styles = StyleSheet.create({
  flex: { flex: 1 }, center: { textAlign: 'center' }, page: { flex: 1, backgroundColor: color.background },
  content: { flexGrow: 1, justifyContent: 'center', padding: space.xl, gap: space.xl },
  brand: { alignItems: 'center', gap: space.xs }, mark: { width: 64, height: 64, borderRadius: radius.lg, backgroundColor: color.primary, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
  card: { backgroundColor: color.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: color.border, padding: space.xl, gap: space.lg },
  retry: { marginTop: space.md, alignSelf: 'flex-start' }, links: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: space.md }, help: { flexDirection: 'row', gap: space.sm, alignItems: 'center', paddingHorizontal: space.sm },
})
