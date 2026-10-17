export type SignInMode = 'sign-in' | 'sign-up' | 'reset'

export const SIGN_IN_TITLES: Record<SignInMode, string> = {
  'sign-in': 'Sign in',
  'sign-up': 'Create an account',
  reset: 'Reset your password',
}

export const SIGN_IN_PITCH = 'Sync your chats, projects, prompts and preferences across devices. API keys stay on each device.'
