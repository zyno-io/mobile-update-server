export class AppError extends Error {}

export function handleError(err: unknown): never {
    if (err instanceof AppError) {
        console.warn(err.message);
        process.exit(1);
    }
    throw err;
}
