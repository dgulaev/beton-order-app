/** Заголовки staff-API: x-user-id из localStorage (как UserRoleProvider). */
export function adminAuthHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init);
  if (typeof window !== 'undefined') {
    const userId = localStorage.getItem('userId');
    if (userId) headers.set('x-user-id', userId);
  }
  return headers;
}

export function adminCifraFetch(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, {
    ...init,
    headers: adminAuthHeaders(init?.headers),
  });
}
