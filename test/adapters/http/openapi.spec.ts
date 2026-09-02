import { REFUSAL_STATUS } from '../../../src/adapters/http/errors/refusal-map.js';
import { BorrowBody } from '../../../src/adapters/http/circulation/dto/borrow-body.dto.js';
import { ReturnBody } from '../../../src/adapters/http/circulation/dto/return-body.dto.js';
import {
  buildOpenApiDocument,
  postOf,
  requiredByDocument,
  propertiesOf,
  requiredByValidator,
  schemaFor,
  statusesOf,
} from '../../support/openapi.js';
import { codeOf } from '../../support/sources.js';

describe('La documentation OpenAPI', () => {
  it('decrit les deux routes, leur corps attendu et leur corps rendu', async () => {
    const document = await buildOpenApiDocument();
    expect(Object.keys(document.paths ?? {}).sort()).toEqual([
      '/loans',
      '/returns',
    ]);

    const lend = postOf(document, '/loans');
    expect(lend.requestBody).toBeDefined();
    expect(lend.responses?.['201']).toBeDefined();
    expect(postOf(document, '/returns').responses?.['200']).toBeDefined();
  });

  it('ne documente AUCUN statut que la table des refus ne produit pas', async () => {
    const document = await buildOpenApiDocument();
    const produced = new Set(Object.values(REFUSAL_STATUS).map(String));
    const nominal = new Set(['200', '201', '400']);

    const invented = statusesOf(document).filter(
      ([, code]) => !produced.has(code) && !nominal.has(code),
    );
    expect(invented).toEqual([]);
  });

  it('documente CHAQUE refus que la route peut reellement produire', async () => {
    const document = await buildOpenApiDocument();
    const documented = new Set(
      Object.keys(postOf(document, '/loans').responses ?? {}),
    );
    for (const code of ['409', '403', '404']) {
      expect(documented).toContain(code);
    }
  });

  it('ne documente aucun 5xx comme une reponse normale', async () => {
    const document = await buildOpenApiDocument();
    const server = statusesOf(document).filter(
      ([, code]) => Number(code) >= 500,
    );
    expect(server).toEqual([]);
  });

  it('ce que le document annonce obligatoire est EXACTEMENT ce que le validateur exige', async () => {
    const document = await buildOpenApiDocument();
    for (const [schema, Dto] of [
      ['BorrowBody', BorrowBody],
      ['ReturnBody', ReturnBody],
    ] as const) {
      expect(requiredByDocument(document, schema)).toEqual(
        await requiredByValidator(Dto),
      );
    }
  });

  it('et ce n est pas vide des deux cotes, ce qui rendrait l egalite creuse', async () => {
    expect(await requiredByValidator(BorrowBody)).toEqual([
      'copyId',
      'memberId',
    ]);
  });

  it('decrit l ENVELOPPE et non le corps nu, sur chaque statut de chaque route', async () => {
    const document = await buildOpenApiDocument();
    for (const [path, code] of statusesOf(document)) {
      const expected = Number(code) < 400 ? 'data' : 'error';
      expect(propertiesOf(document, schemaFor(document, path, code))).toEqual([
        expected,
      ]);
    }
  });

  it('et tous les refus renvoient au MEME schema, pas a un par statut', async () => {
    const document = await buildOpenApiDocument();
    const refs = statusesOf(document)
      .filter(([, code]) => Number(code) >= 400)
      .map(([path, code]) => schemaFor(document, path, code)?.['$ref']);
    expect(refs.length).toBeGreaterThan(1);
    expect(new Set(refs).size).toBe(1);
  });

  it('la documentation n est pas montee inconditionnellement', () => {
    const code = codeOf('src/adapters/http/openapi.ts');
    expect(code).toMatch(/process\.env/);
    expect(code).not.toMatch(/SwaggerModule\.setup\([^)]*\);\s*\}\s*$/);
  });
});
