// Envoi d'un fichier vers une URL signée (bucket R2, ou API locale en
// développement) avec progression. Le jeton CSRF ne part que vers notre API.

function csrfHeader(): Record<string, string> {
  const m = document.cookie.match(/(?:^|;\s*)md_csrf=([^;]+)/);
  return m?.[1] ? { "x-csrf-token": decodeURIComponent(m[1]) } : {};
}

export function putFile(
  url: string,
  file: Blob,
  headers: Record<string, string>,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    const sameOrigin = url.startsWith("/");
    if (sameOrigin) xhr.withCredentials = true;
    for (const [k, v] of Object.entries({ ...headers, ...(sameOrigin ? csrfHeader() : {}) })) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Envoi refusé (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Connexion interrompue pendant l’envoi."));
    xhr.send(file);
  });
}
