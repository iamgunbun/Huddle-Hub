// A vanilla JS replication of Svelte's internal 'get' function
export const get = (store) => {
    let value;
    store.subscribe((v) => { value = v; })();
    return value;
};

// A vanilla JS replication of Svelte's 'writable' store
export const writable = (initialValue) => {
    let value = initialValue;
    const subscribers = new Set();
    
    return {
        subscribe: (fn) => {
            subscribers.add(fn);
            fn(value);
            return () => subscribers.delete(fn);
        },
        set: (newValue) => {
            value = newValue;
            subscribers.forEach(fn => fn(value));
        },
        update: (fn) => {
            value = fn(value);
            subscribers.forEach(fn => fn(value));
        }
    };
};