// spur: Admins get the activation link in the response, so they can pass it on themselves when spur
// has no email set up. With email set up, the link is also emailed as before.
import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import { User } from '../../../../app/src/models/User.mjs'
import EmailHandler from '../../../../app/src/Features/Email/EmailHandler.mjs'
import { emailIsConfigured } from '../../../../app/src/Features/Email/EmailConfiguration.mjs'
import OneTimeTokenHandler from '../../../../app/src/Features/Security/OneTimeTokenHandler.mjs'
import { OError } from '../../../../app/src/Features/Errors/Errors.js'

const ONE_WEEK = 7 * 24 * 60 * 60 // seconds

async function userEmail(userId) {
  const user = await User.findById(userId, { email: 1, _id: 0 }).lean()
  if (!user) {
    throw new OError('User does not exist, cannot create activation link', { userId })
  }
  return user.email
}

async function newLink(userId, email) {
  const token = await OneTimeTokenHandler.promises.getNewToken(
    'password',
    { user_id: userId, email },
    { expiresIn: ONE_WEEK }
  )
  return `${Settings.siteUrl}/user/activate?token=${token}&user_id=${userId}`
}

export async function createActivationLink(userId) {
  return await newLink(userId, await userEmail(userId))
}

export async function inviteUser(userId) {
  const email = await userEmail(userId)
  const activationUrl = await newLink(userId, email)
  if (!emailIsConfigured()) return { activationUrl, emailSent: false }
  try {
    await EmailHandler.promises.sendEmail('registered', { to: email, setNewPasswordUrl: activationUrl })
  } catch (err) {
    logger.warn({ err, email }, 'failed to send activation email')
    return { activationUrl, emailSent: false }
  }
  return { activationUrl, emailSent: true }
}
