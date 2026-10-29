// GET /sites/{slug}/media/{id}.jpg and .svg (BLUEPRINT §5.1): a card or art document a release names, streamed as bytes
// (an <img src>, never markup: Munim gotcha 15).
import { z } from 'zod';
import { Id, Slug } from './common.ts';

export const MediaParams = z.strictObject({ slug: Slug, id: Id });
