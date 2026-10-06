// Médias des offres : vidéos MOV d'iPhone acceptées (envoi direct si le
// navigateur n'a pas pu convertir), limite vidéo relevée, contrôle des octets.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@misterdou/db";
import { registerMediaRoutes } from "../src/modules/media/routes.js";
import { writeLocalMedia } from "../src/lib/media.js";
import { authFor, buildMiniApp, cleanup, createProduct, createSeller, createUser, tracker } from "./helpers.js";

const t = tracker();

afterAll(async () => {
  await cleanup(t);
});

// En-tête d'un MOV d'iPhone : boîte « ftyp » de marque « qt  ».
const MOV = Buffer.concat([Buffer.from([0, 0, 0, 20]), Buffer.from("ftypqt  "), Buffer.alloc(52)]);

async function sellerApp() {
  const owner = await createUser(t, { role: "VENDOR", kycVerified: true });
  const seller = await createSeller(t, owner);
  const product = await createProduct(t, { sellerId: seller.id });
  const app = await buildMiniApp({ auth: await authFor(owner.id) }, async (instance) => {
    await instance.register(registerMediaRoutes, { prefix: "/api/v1" });
  });
  return { app, product };
}

describe("Vidéos d'iPhone sur une offre", () => {
  it("accepte un MOV de 120 Mo puis l'enregistre après contrôle du fichier", async () => {
    const { app, product } = await sellerApp();
    const big = await app.inject({
      method: "POST",
      url: `/api/v1/products/${product.id}/media/upload-url`,
      payload: { mimeType: "video/quicktime", sizeBytes: 120 * 1024 * 1024 },
    });
    expect(big.statusCode).toBe(200);
    expect(big.json().data.key).toMatch(/\.mov$/);

    const ticket = await app.inject({
      method: "POST",
      url: `/api/v1/products/${product.id}/media/upload-url`,
      payload: { mimeType: "video/quicktime", sizeBytes: MOV.length },
    });
    const key = ticket.json().data.key as string;
    await writeLocalMedia(key, MOV);
    const saved = await app.inject({ method: "POST", url: `/api/v1/products/${product.id}/media`, payload: { key, mimeType: "video/quicktime" } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data).toMatchObject({ kind: "video", mimeType: "video/quicktime" });
    expect(await prisma.productImage.count({ where: { productId: product.id } })).toBe(1);
    await app.close();
  });

  it("refuse un faux MOV et une vidéo au-delà de 200 Mo", async () => {
    const { app, product } = await sellerApp();
    const tooBig = await app.inject({
      method: "POST",
      url: `/api/v1/products/${product.id}/media/upload-url`,
      payload: { mimeType: "video/quicktime", sizeBytes: 201 * 1024 * 1024 },
    });
    expect(tooBig.json().error.code).toBe("FILE_TOO_LARGE");

    const fake = Buffer.from("ceci n'est pas une vidéo, juste du texte assez long");
    const ticket = await app.inject({
      method: "POST",
      url: `/api/v1/products/${product.id}/media/upload-url`,
      payload: { mimeType: "video/quicktime", sizeBytes: fake.length },
    });
    const key = ticket.json().data.key as string;
    await writeLocalMedia(key, fake);
    const refused = await app.inject({ method: "POST", url: `/api/v1/products/${product.id}/media`, payload: { key, mimeType: "video/quicktime" } });
    expect(refused.json().error.code).toBe("FILE_TYPE_INVALID");
    await app.close();
  });
});
