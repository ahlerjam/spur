import Settings from '@overleaf/settings'

// spur: Without a sender and a transport, EmailSender only logs; callers use this to stop reporting
// "email sent" and to hand out links themselves.
export function emailIsConfigured() {
  const email = Settings.email
  const parameters = email?.parameters ?? {}
  return Boolean(
    email?.fromAddress &&
      (parameters.host || parameters.AWSAccessKeyID || email.driver === 'ses')
  )
}
