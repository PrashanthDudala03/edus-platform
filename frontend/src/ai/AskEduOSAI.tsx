import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { FileText, Loader2, RotateCcw, SendHorizontal, Sparkles, X } from 'lucide-react'
import client from '../api/client'
import { useAuthStore } from '../store/auth'
import { ASK_TIMEOUT_MS, MAX_QUESTION_CHARS, askBody, canSend, canSeeAssistantEntry, canUseAssistant, limitHint, messages, replyFor, replyForFailure, statusNotice, type Reply, type Source } from './assistant'

type Message = { id: number } & ({ from: 'user'; text: string } | { from: 'assistant'; reply: Reply })

const suggestions = ['What does the school policy say about attendance?', 'Summarize the leave policy.', 'When are the upcoming exams?', 'Explain photosynthesis in simple words.']

// The conversation lives in memory for this signed-in session only. Each question is sent on its own:
// nothing earlier is sent with it, and nothing is written to browser storage.
export function AskEduOSAI() {
  const user = useAuthStore(s => s.user)
  const owner = user ? user.id + ':' + user.schoolId : ''
  const [open, setOpen] = useState(false), [conversation, setConversation] = useState<Message[]>([]), [busy, setBusy] = useState(false)
  const session = useRef(owner), next = useRef(1), sending = useRef(false), entry = useRef<HTMLButtonElement>(null), wasOpen = useRef(false)
  // Closing the panel puts the keyboard back where it was opened from.
  useEffect(() => { if (wasOpen.current && !open) entry.current?.focus(); wasOpen.current = open }, [open])
  // Another account or school never sees what the previous one asked.
  useEffect(() => { if (session.current !== owner) { session.current = owner; sending.current = false; setConversation([]); setBusy(false); setOpen(false) } }, [owner])
  if (!canSeeAssistantEntry(user)) return null
  // The button may be shown for a demonstration; asking is only for users whose session holds the permission.
  const allowed = canUseAssistant(user)

  const add = (message: { from: 'user'; text: string } | { from: 'assistant'; reply: Reply }) => setConversation(all => [...all, { ...message, id: next.current++ }])
  const ask = async (question: string) => {
    // One question at a time, even if Send is pressed twice before the screen updates.
    if (!allowed || sending.current || !canSend(question, false)) return
    const asked = session.current
    sending.current = true; add({ from: 'user', text: question.trim() }); setBusy(true)
    let reply: Reply
    try { reply = replyFor((await client.post('/ai/assistant/ask', askBody(question), { timeout: ASK_TIMEOUT_MS })).data?.data) }
    catch (error) { reply = axios.isAxiosError(error) ? replyForFailure(error.response?.status, error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') : replyForFailure(undefined) }
    if (session.current !== asked) return
    sending.current = false; add({ from: 'assistant', reply }); setBusy(false)
  }
  return <>
    <button type="button" ref={entry} className="ai-entry" aria-label="Ask EduOS AI" aria-haspopup="dialog" onClick={() => setOpen(true)}><Sparkles size={16} /><span>Ask EduOS AI</span></button>
    {open && <Panel owner={owner} allowed={allowed} conversation={conversation} busy={busy} onAsk={ask} onClear={() => setConversation([])} onClose={() => setOpen(false)} />}
  </>
}

function Panel({ owner, allowed, conversation, busy, onAsk, onClear, onClose }: { owner: string, allowed: boolean, conversation: Message[], busy: boolean, onAsk: (question: string) => void, onClear: () => void, onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), log = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null)
  const [draft, setDraft] = useState('')
  const status = useQuery({ queryKey: ['ai-status', owner], enabled: allowed, staleTime: 30000, retry: false, queryFn: async () => (await client.get('/ai/status')).data?.data })
  // A user without the permission is told so here; nothing is asked of the assistant on their behalf.
  const notice = !allowed ? { text: messages.notEnabledForAccount, blocks: true } : status.isError ? { text: replyForFailure(axios.isAxiosError(status.error) ? status.error.response?.status ?? 503 : 503).text, blocks: false } : statusNotice(status.data)
  const blocked = !!notice?.blocks, hint = limitHint(draft)
  useEffect(() => { dialog.current?.showModal(); input.current?.focus(); return () => dialog.current?.close() }, [])
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight }, [conversation, busy])
  const send = () => { if (blocked || !canSend(draft, busy)) return; onAsk(draft); setDraft(''); input.current?.focus() }
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send() } }
  return <dialog ref={dialog} className="ai-panel" aria-label="Ask EduOS AI" onCancel={event => { event.preventDefault(); onClose() }}>
    <header className="ai-header"><span className="ai-mark"><Sparkles size={18} /></span><div><h2>EduOS AI</h2><small>Your school assistant</small></div>
      {conversation.length > 0 && <button type="button" className="icon-button" aria-label="Start a new conversation" title="Start a new conversation" disabled={busy} onClick={() => { onClear(); input.current?.focus() }}><RotateCcw size={17} /></button>}
      <button type="button" className="icon-button" aria-label="Close EduOS AI" onClick={onClose}><X size={20} /></button></header>
    {notice && <p className="ai-banner" role="status">{notice.text}</p>}
    <div className="ai-log" ref={log} role="log" aria-live="polite" aria-label="Conversation" tabIndex={0}>
      {conversation.length === 0 && <div className="ai-welcome"><span className="ai-mark large"><Sparkles size={24} /></span><h3>How can I help?</h3>
        <p>Ask about your school's documents and policies, school information your account can see, or general study topics.</p>
        <div className="ai-suggestions" aria-label="Example questions">{suggestions.map(example => <button type="button" key={example} disabled={blocked} onClick={() => { setDraft(example); input.current?.focus() }}>{example}</button>)}</div></div>}
      {conversation.map(message => message.from === 'user'
        ? <div key={message.id} className="ai-message from-user"><p>{message.text}</p></div>
        : <div key={message.id} className={'ai-message from-assistant ' + message.reply.kind}><span className="ai-author">EduOS AI</span>
          {/* Plain text only: what a model writes is never treated as markup or as a link. */}
          <p>{message.reply.text}</p>
          {message.reply.kind === 'answer' && message.reply.note && <small className="ai-shortened ai-note">{message.reply.note}</small>}
          {message.reply.kind === 'answer' && message.reply.shortened && <small className="ai-shortened">This answer was shortened.</small>}
          {message.reply.kind === 'answer' && message.reply.sources.length > 0 && <Sources sources={message.reply.sources} />}</div>)}
      {busy && <div className="ai-message from-assistant thinking" role="status"><span className="ai-author">EduOS AI</span><p><Loader2 className="spin" size={15} />Working on your question…</p></div>}
    </div>
    <form className="ai-composer" onSubmit={event => { event.preventDefault(); send() }}>
      <label htmlFor="ai-question">Your question</label>
      <div className="ai-input"><textarea id="ai-question" ref={input} rows={2} value={draft} maxLength={MAX_QUESTION_CHARS} disabled={blocked} placeholder="Ask EduOS AI…" aria-describedby="ai-help" onChange={event => setDraft(event.target.value)} onKeyDown={onKey} />
        <button type="submit" className="ai-send" aria-label="Send question" disabled={blocked || !canSend(draft, busy)}>{busy ? <Loader2 className="spin" size={18} /> : <SendHorizontal size={18} />}</button></div>
      <div className="ai-help" id="ai-help"><span>{hint ? <strong className={draft.length >= MAX_QUESTION_CHARS ? 'at-limit' : ''} role="status">{hint}</strong> : 'Enter to send · Shift+Enter for a new line'}</span></div>
      <p className="ai-scope">EduOS AI answers from your school's documents and the school information your account can access. General answers are not specific to your school. It cannot look up individual people yet. Each question is answered on its own, and this conversation is not saved.</p>
    </form>
  </dialog>
}

function Sources({ sources }: { sources: Source[] }) {
  return <div className="ai-sources"><span className="ai-sources-title">Sources</span><ul>{sources.map(source => <li key={source.number}><FileText size={15} /><div><strong>{source.title}</strong>
    <small>{[source.section, source.page ? 'Page ' + source.page : null, source.label].filter(Boolean).join(' · ')}</small></div></li>)}</ul></div>
}
