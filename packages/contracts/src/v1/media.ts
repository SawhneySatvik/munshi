// GET /sites/{slug}/media/{id}.jpg and .svg: a card or art document a release names, streamed as bytes
// for an <img src>, never as markup a page inlines, so nothing in an SVG can run as script.
import { z } from 'zod';
import { Id, Slug } from './common.ts';

export const MediaParams = z.strictObject({ slug: Slug, id: Id });
