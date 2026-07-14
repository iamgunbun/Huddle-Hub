// Intercepts Svelte's goto() and uses standard browser routing
export const goto = (path) => {
    window.location.href = path;
};