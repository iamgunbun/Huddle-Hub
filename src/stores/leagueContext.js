import { writable } from '../svelte-mock';

export const activeLeague = writable({
    id: null,
    sleeper_league_id: null,
    platform: 'sleeper',
    league_name: 'Loading...',
    theme_settings: null,
    homepage_text: '',
    constitution_text: '',
    logo_url: null,
    is_commissioner: false
});

// We only need to export the mock store here. 
// The actual loading logic is handled by React in src/context/LeagueContext.jsx