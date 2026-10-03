import { useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Redirect, useRouter } from 'expo-router'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod'
import { normalizeError } from '@/api/errors'
import { Chips, LinkText } from '@/components/blocks'
import { AppText, Button, Notice, TextField } from '@/components/ui'
import { ACCOUNT_TYPES, cleanSchoolCode, passwordProblem } from '@/features/account/rules'
import { account, useSession } from '@/services'
import { color, radius, space } from '@/theme/tokens'

// Asking a school for an account, as on EduOS web. This sends a request only: the school administrator checks who the
// person is and assigns the role, and the account works after that. The school is found from the code the school gave
// out; nobody types or sees a school id.
const schema = z.object({
  firstName: z.string().trim().min(1, 'Enter your first name.').max(100, 'That is too long.'),
  lastName: z.string().trim().min(1, 'Enter your last name.').max(100, 'That is too long.'),
  email: z.string().trim().max(255, 'That is too long.').email('Enter a valid email.'),
  phone: z.string().trim().min(1, 'Enter your mobile number.').max(20, 'That is too long.'),
  schoolCode: z.string().transform(cleanSchoolCode).pipe(z.string().min(1, 'Enter the school code from your school.').max(64, 'That is not a school code.')),
  requestedRole: z.enum(ACCOUNT_TYPES),
  password: z.string().superRefine((value, context) => { const problem = passwordProblem(value); if (problem) context.addIssue({ code: 'custom', message: problem }) }),
})
type Form = z.input<typeof schema>

export default function SignupScreen() {
  const router = useRouter(), { status, welcomePending } = useSession()
  const { control, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { firstName: '', lastName: '', email: '', phone: '', schoolCode: '', requestedRole: 'Parent', password: '' } })
  const [failure, setFailure] = useState(''), [done, setDone] = useState('')
  if (status === 'signed-in') return <Redirect href={welcomePending ? '/welcome' : '/home'} />
  const back = () => { if (router.canGoBack()) router.back(); else router.replace('/login') }
  const submit = handleSubmit(async values => {
    setFailure('')
    try { setDone(await account.requestAccess(values)) } catch (error) { setFailure(normalizeError(error).message) }
  })
  const field = (name: Exclude<keyof Form, 'requestedRole'>, label: string, props: Partial<React.ComponentProps<typeof TextField>> = {}) =>
    <Controller control={control} name={name} render={({ field: { onChange, onBlur, value } }) => <TextField label={label} value={value} onChangeText={onChange} onBlur={onBlur} error={errors[name]?.message} autoCorrect={false} {...props} />} />

  return <SafeAreaView style={styles.page}><KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View style={styles.heading}><AppText variant="display" accessibilityRole="header">Create account</AppText>
        <AppText tone="muted">Ask your school for access. Your school administrator checks your details and gives you the right role before you can sign in.</AppText></View>
      {done ? <View style={styles.card}>
        <Notice message={done} />
        <AppText tone="muted">You will be able to sign in with your email and the password you chose once your school approves the request. Requests that are not reviewed expire after 30 days.</AppText>
        <Button label="Back to sign in" icon="arrow-back" onPress={back} />
      </View> : <View style={styles.card}>
        {!!failure && <Notice tone="danger" message={failure} />}
        {field('firstName', 'First name', { autoComplete: 'given-name', textContentType: 'givenName', autoCapitalize: 'words' })}
        {field('lastName', 'Last name', { autoComplete: 'family-name', textContentType: 'familyName', autoCapitalize: 'words' })}
        {field('email', 'Email', { autoComplete: 'email', textContentType: 'emailAddress', keyboardType: 'email-address', autoCapitalize: 'none', placeholder: 'you@example.com' })}
        {field('phone', 'Mobile number', { autoComplete: 'tel', textContentType: 'telephoneNumber', keyboardType: 'phone-pad' })}
        {field('schoolCode', 'School code', { autoCapitalize: 'none', autoComplete: 'off', placeholder: 'The code your school gave you' })}
        <View style={styles.choice}><AppText variant="label" tone="muted">I am a</AppText>
          <Controller control={control} name="requestedRole" render={({ field: { onChange, value } }) => <Chips wrap options={ACCOUNT_TYPES.map(type => ({ key: type, label: type }))} value={value} onChange={onChange} />} />
          <AppText variant="caption" tone="muted">This tells your school what you are asking for. The school decides the role you receive.</AppText></View>
        {field('password', 'Password', { secure: true, autoCapitalize: 'none', autoComplete: 'new-password', textContentType: 'newPassword', placeholder: 'At least 16 characters' })}
        <Button label={isSubmitting ? 'Sending…' : 'Send request'} icon="paper-plane-outline" loading={isSubmitting} onPress={submit} />
      </View>}
      {!done && <View style={styles.footer}><AppText tone="muted">Already have an account?</AppText><LinkText label="Sign in" onPress={back} /></View>}
    </ScrollView></KeyboardAvoidingView></SafeAreaView>
}
const styles = StyleSheet.create({
  flex: { flex: 1 }, page: { flex: 1, backgroundColor: color.background },
  content: { flexGrow: 1, padding: space.xl, gap: space.xl }, heading: { gap: space.xs, marginTop: space.md },
  card: { backgroundColor: color.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: color.border, padding: space.xl, gap: space.lg },
  choice: { gap: space.sm }, footer: { flexDirection: 'row', gap: space.sm, justifyContent: 'center', alignItems: 'center' },
})
