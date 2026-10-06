// Mise en page HTML des e-mails : code mis en valeur, bouton pour un lien seul,
// texte échappé (aucune balise injectée par un titre ou un message).
import { describe, expect, it } from "vitest";
import { renderEmailHtml } from "../src/lib/email-layout.js";

describe("E-mails mis en page", () => {
  it("met le code en valeur et transforme un lien seul en bouton", () => {
    const html = renderEmailHtml("Votre code", "Bonjour,\n\nVotre code : 683344\n\nhttps://misterdou.test/mot-de-passe-oublie");
    expect(html).toContain("letter-spacing:8px");
    expect(html).toContain(">683344</div>");
    expect(html).toContain('href="https://misterdou.test/mot-de-passe-oublie"');
    expect(html).toContain("Ouvrir sur MISTERDOU");
    expect(html.length).toBeLessThan(6000);
  });

  it("échappe le texte", () => {
    const html = renderEmailHtml("<b>Titre</b>", "Message <script>alert(1)</script> & co");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;b&gt;Titre&lt;/b&gt;");
  });
});
