import { useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Redirect, useRouter } from 'expo-router'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod'
import { normalizeError } from '@/api/errors'
import { LinkText } from '@/components/blocks'
import { AppText, Button, Notice, TextField } from '@/components/ui'
import { passwordProblem, recoveryCodeProblem } from '@/features/account/rules'
import { account, useSession } from '@/services'
import { color, radius, space } from '@/theme/tokens'

// Setting a new password, as on EduOS web. EduOS has no "email me a link": a school administrator verifies the person
// and issues a one-time code, which is entered here with the new password. The code works once and for 15 minutes.
const refine = (problem: (value: string) => string) => z.string().superRefine((value, context) => { const message = problem(value); if (message) context.addIssue({ code: 'custom', message }) })
const schema = z.object({ code: refine(recoveryCodeProblem), password: refine(passwordProblem) })
type Form = z.infer<typeof schema>

export default function RecoverScreen() {
  const router = useRouter(), { status, welcomePending } = useSession()
  const { control, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { code: '', password: '' } })
  const [failure, setFailure] = useState(''), [done, setDone] = useState('')
  if (status === 'signed-in') return <Redirect href={welcomePending ? '/welcome' : '/home'} />
  const back = () => { if (router.canGoBack()) router.back(); else router.replace('/login') }
  const submit = handleSubmit(async values => {
    setFailure('')
    try { setDone(await account.resetPassword(values.code, values.password)) } catch (error) { setFailure(normalizeError(error).message) }
  })

  return <SafeAreaView style={styles.page}><KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View style={styles.heading}><AppText variant="display" accessibilityRole="header">Reset password</AppText>
        <AppText tone="muted">Ask your school administrator for a recovery code. They will confirm it is you and give you a one-time code that works for 15 minutes.</AppText></View>
      {done ? <View style={styles.card}>
        <Notice message={done} />
        <AppText tone="muted">Every device that was signed in to this account has been signed out.</AppText>
        <Button label="Back to sign in" icon="arrow-back" onPress={back} />
      </View> : <View style={styles.card}>
        {!!failure && <Notice tone="danger" message={failure} />}
        <Controller control={control} name="code" render={({ field: { onChange, onBlur, value } }) => <TextField label="Recovery code" value={value} onChangeText={onChange} onBlur={onBlur} error={errors.code?.message}
          autoCapitalize="characters" autoCorrect={false} autoComplete="off" multiline placeholder="Paste the 64-character code" />} />
        <Controller control={control} name="password" render={({ field: { onChange, onBlur, value } }) => <TextField label="New password" secure value={value} onChangeText={onChange} onBlur={onBlur} error={errors.password?.message}
          autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" placeholder="At least 16 characters" />} />
        <Button label={isSubmitting ? 'Changing password…' : 'Change password'} icon="key-outline" loading={isSubmitting} onPress={submit} />
      </View>}
      {!done && <View style={styles.footer}><LinkText label="Back to sign in" onPress={back} /></View>}
    </ScrollView></KeyboardAvoidingView></SafeAreaView>
}
const styles = StyleSheet.create({
  flex: { flex: 1 }, page: { flex: 1, backgroundColor: color.background },
  content: { flexGrow: 1, padding: space.xl, gap: space.xl }, heading: { gap: space.xs, marginTop: space.md },
  card: { backgroundColor: color.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: color.border, padding: space.xl, gap: space.lg },
  footer: { alignItems: 'center' },
})
