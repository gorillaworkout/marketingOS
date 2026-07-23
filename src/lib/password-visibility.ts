export function passwordInputType(isVisible: boolean): 'password' | 'text' {
  return isVisible ? 'text' : 'password';
}
