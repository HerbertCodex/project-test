import { readFileSync } from 'node:fs';
import { REFUSAL_STATUS } from '../../../src/adapters/http/errors/refusal-map.js';
import { buildOpenApiDocument } from '../../support/openapi.js';

const BLOCK_COMMENT = new RegExp('/\\*[\\s\\S]*?\\*/', 'g');
const LINE_COMMENT = new RegExp('//[^\\n]*', 'g');

/**
 * Le code d'un fichier, commentaires ôtés.
 *
 * @param path - le fichier à lire
 * @returns son code seul
 */
function codeOf(path: string): string {
  return readFileSync(path, 'utf8').replace(BLOCK_COMMENT, ' ').replace(LINE_COMMENT, ' ');
}

describe('La documentation OpenAPI', () => {
  it('decrit les deux routes, leur corps attendu et leur corps rendu', async () => {
    const document = await buildOpenApiDocument();
    expect(Object.keys(document.paths ?? {}).sort()).toEqual(['/loans', '/returns']);

    const lend = document.paths?.['/loans']?.post;
    expect(lend?.requestBody).toBeDefined();
    expect(lend?.responses?.['201']).toBeDefined();
    expect(document.paths?.['/returns']?.post?.responses?.['200']).toBeDefined();
  });

  it('ne documente AUCUN statut que la table des refus ne produit pas', async () => {
    const document = await buildOpenApiDocument();
    const produced = new Set(Object.values(REFUSAL_STATUS).map(String));
    const nominal = new Set(['200', '201', '400']);

    const invented: string[] = [];
    for (const [path, item] of Object.entries(document.paths ?? {})) {
      for (const code of Object.keys(item.post?.responses ?? {})) {
        if (!produced.has(code) && !nominal.has(code)) invented.push(`${path}: ${code}`);
      }
    }
    expect(invented).toEqual([]);
  });

  it('documente CHAQUE refus que la route peut reellement produire', async () => {
    const document = await buildOpenApiDocument();
    const documented = new Set(Object.keys(document.paths?.['/loans']?.post?.responses ?? {}));
    for (const code of ['409', '403', '404']) {
      expect(documented).toContain(code);
    }
  });

  it('ne documente aucun 5xx comme une reponse normale', async () => {
    const document = await buildOpenApiDocument();
    const server: string[] = [];
    for (const [path, item] of Object.entries(document.paths ?? {})) {
      for (const code of Object.keys(item.post?.responses ?? {})) {
        if (Number(code) >= 500) server.push(`${path}: ${code}`);
      }
    }
    expect(server).toEqual([]);
  });

  it('les contraintes des DTO sont declarees une seule fois', async () => {
    const document = await buildOpenApiDocument();
    const borrow = document.components?.schemas?.BorrowBody;
    expect(borrow).toBeDefined();
    expect((borrow as { required?: string[] }).required?.sort()).toEqual(['copyId', 'memberId']);
  });

  it('la documentation n est pas montee inconditionnellement', () => {
    const code = codeOf('src/adapters/http/openapi.ts');
    expect(code).toMatch(/process\.env/);
    expect(code).not.toMatch(/SwaggerModule\.setup\([^)]*\);\s*\}\s*$/);
  });
});
