// What the mocked next/navigation notFound() throws, as Next's own does to end a render with the 404 page.
export class NotFound extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
  }
}
