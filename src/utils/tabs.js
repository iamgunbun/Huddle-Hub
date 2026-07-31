export const tabs = [
    { icon: 'home', label: 'Home', dest: '/', key: 'home' },
    { icon: 'bolt', label: 'Vs', dest: '/matchups', key: 'matchups' },
    { icon: 'badge', label: 'My Team', dest: '/rosters', key: 'my_team' },
    { icon: 'groups', label: 'Players', dest: '/players', key: 'players' },
    { icon: 'swap_horiz', label: 'Transactions', dest: '/transactions', key: 'transactions' },
    {
        icon: 'build',
        label: 'Tools & Graders',
        nest: true,
        key: 'tools',
        children: [
            { icon: 'psychology', label: 'Start / Sit', dest: '/start-sit' },
            { icon: 'gavel', label: 'Trade Grader', dest: '/trade-analyzer' },
            { icon: 'school', label: 'Draft Grader', dest: '/draft-analyzer' },
        ]
    },
    {
        icon: 'view_comfy',
        label: 'League Info',
        nest: true,
        key: 'league_info',
        children: [
            { icon: 'people', label: 'Managers', dest: '/managers' },
            { icon: 'local_fire_department', label: 'Rivalry', dest: '/rivalry' },
            { icon: 'leaderboard', label: 'Standings', dest: '/standings' },
            { icon: 'view_comfy', label: 'Drafts', dest: '/drafts' },
            { icon: 'emoji_events', label: 'Trophy Room', dest: '/awards' },
            { icon: 'military_tech', label: 'Records', dest: '/records' },
            { icon: 'format_list_numbered', label: 'Scoring Format', dest: '/scoring' },
            { icon: 'history_edu', label: 'Constitution', dest: '/constitution' },
            { icon: 'sports_football', label: 'Go to Sleeper', dest: `https://sleeper.app/leagues/` }
        ]
    },
    {
        icon: 'settings',
        label: 'Settings',
        nest: true,
        key: 'settings',
        children: [
            { icon: 'person', label: 'User Account', dest: '/account' },
            { icon: 'edit_note', label: 'Admin: Notes', dest: '/admin/notes' },
            { icon: 'payments', label: 'Admin: Fees', dest: '/admin/fees' },
            { icon: 'gavel', label: 'Admin: Constitution', dest: '/admin/constitution' }
        ]
    }
];