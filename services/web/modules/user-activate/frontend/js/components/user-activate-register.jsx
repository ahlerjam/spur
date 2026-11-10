import { useState } from 'react'
import PropTypes from 'prop-types'
import RegisterForm from './register-form'
import OLRow from '@/shared/components/ol/ol-row'
import OLCol from '@/shared/components/ol/ol-col'
import OLCard from '@/shared/components/ol/ol-card'
import Notification from '@/shared/components/notification'
import EinladungsLink from '@modules/spur/frontend/js/einladung/einladungs-link'

function UserActivateRegister() {
  const [emails, setEmails] = useState([])
  const [failedEmails, setFailedEmails] = useState([])
  const [registerError, setRegisterError] = useState(false)
  const [registrationSuccess, setRegistrationSuccess] = useState(false)

  return (
    <OLRow>
      <OLCol>
        <OLCard>
          <div className="page-header">
            <h1>Register new users</h1>
          </div>
          <RegisterForm
            setRegistrationSuccess={setRegistrationSuccess}
            setEmails={setEmails}
            setRegisterError={setRegisterError}
            setFailedEmails={setFailedEmails}
          />
          {registerError ? (
            <UserActivateError failedEmails={failedEmails} />
          ) : null}
          {registrationSuccess ? <InvitationLinks emails={emails} /> : null}
        </OLCard>
      </OLCol>
    </OLRow>
  )
}

function UserActivateError({ failedEmails }) {
  return (
    <div className="row-spaced">
      <Notification
        type="error"
        content="Sorry, an error occured, failed to register these email:"
        className="mb-3"
      />
      <ul>
        {failedEmails.map(email => (
          <li key={email}>{email}</li>
        ))}
      </ul>
    </div>
  )
}

// spur: one copyable link per account; the hint about email (sent or not set up) only once, above the first.
function InvitationLinks({ emails }) {
  return (
    <div className="row-spaced">
      {emails.map((user, i) => (
        <div key={user.email}>
          <h2 className="h5">{user.email}</h2>
          <EinladungsLink
            url={user.setNewPasswordUrl}
            perMail={i === 0 ? user.emailConfigured : undefined}
          />
        </div>
      ))}
    </div>
  )
}

InvitationLinks.propTypes = {
  emails: PropTypes.array,
}
UserActivateError.propTypes = {
  failedEmails: PropTypes.array,
}

export default UserActivateRegister
