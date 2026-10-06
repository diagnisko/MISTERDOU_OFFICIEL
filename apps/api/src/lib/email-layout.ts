// ---------------------------------------------------------------------------
// Mise en page HTML des e-mails : bandeau MISTERDOU, carte claire, bouton
// d'action, code mis en valeur. Tableaux et styles en ligne (seule méthode
// fiable dans Gmail, Outlook et les messageries des téléphones), aucune image
// ni police externe : le message reste léger et s'affiche tout de suite.
// La version texte est toujours envoyée aussi.
// ---------------------------------------------------------------------------

const BRAND = "#e84724";
const INK = "#1c1412";
const MUTED = "#6f625e";

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const URL_ONLY = /^https?:\/\/\S+$/;
// « Votre code : 123456 » : le code s'affiche en grand.
const CODE_LINE = /^(.*?)\s*:\s*([0-9]{4,8})$/;

function paragraph(block: string): string {
  const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
  // Lien seul sur sa ligne : bouton (et le lien en clair, en petit, en secours).
  if (lines.length === 1 && URL_ONLY.test(lines[0]!)) {
    const url = escapeHtml(lines[0]!);
    return `<tr><td style="padding:8px 0 4px">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="border-radius:12px;background:${BRAND}">
        <a href="${url}" style="display:inline-block;padding:13px 26px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:12px">Ouvrir sur MISTERDOU</a>
      </td></tr></table>
      <p style="margin:10px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11.5px;line-height:1.5;color:${MUTED};word-break:break-all">${url}</p>
    </td></tr>`;
  }
  const code = lines.length === 1 ? CODE_LINE.exec(lines[0]!) : null;
  if (code) {
    return `<tr><td style="padding:6px 0 10px">
      <p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${MUTED}">${escapeHtml(code[1]!)}</p>
      <div style="display:inline-block;padding:14px 22px;border-radius:14px;background:#fff4ee;border:1px solid #ffd2bd;font-family:'Courier New',Courier,monospace;font-size:30px;font-weight:bold;letter-spacing:8px;color:${INK}">${escapeHtml(code[2]!)}</div>
    </td></tr>`;
  }
  // Texte : liens cliquables, retours à la ligne conservés.
  const html = lines
    .map((line) => escapeHtml(line).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" style="color:${BRAND};word-break:break-all">${u}</a>`))
    .join("<br>");
  return `<tr><td style="padding:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:${INK}">${html}</td></tr>`;
}

/** Page HTML complète d'un e-mail à partir de son objet et de son texte. */
export function renderEmailHtml(subject: string, text: string): string {
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const preheader = escapeHtml((blocks.find((b) => !URL_ONLY.test(b)) ?? subject).slice(0, 110));
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4efec">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${preheader}</span>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4efec"><tr><td align="center" style="padding:28px 14px">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px">
    <tr><td style="background:#0b0605;border-radius:18px 18px 0 0;padding:22px 28px">
      <span style="font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:bold;letter-spacing:1px;color:#f5ede9">MISTERDOU<span style="color:#ff6a32">.</span></span>
    </td></tr>
    <tr><td style="height:3px;line-height:3px;font-size:0;background:${BRAND}">&nbsp;</td></tr>
    <tr><td style="background:#ffffff;border-radius:0 0 18px 18px;padding:28px 28px 18px">
      <h1 style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:20px;line-height:1.35;color:${INK}">${escapeHtml(subject)}</h1>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${blocks.map(paragraph).join("")}</table>
    </td></tr>
    <tr><td style="padding:18px 10px 0;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:11.5px;line-height:1.6;color:#8a7d78">
      Comptes eFootball vérifiés · paiement par Wave<br>
      MISTERDOU ne vous demandera jamais votre mot de passe ni un code par téléphone.
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}
