// NOTE: nothing imports this today -- the live navigation is built inline in
// components/Sidebar.jsx and components/MobileBottomNav.jsx. It is kept in
// step with them so it cannot quietly become a wrong map of the app for
// whoever wires it up next.
export const tabs = [
    { icon: 'home', label: 'Home', dest: '/', key: 'home' },
    { icon: 'bolt', label: 'Vs', dest: '/matchups', key: 'matchups' },
    { icon: 'badge', label: 'My Team', dest: '/rosters', key: 'my_team' },
    { icon: 'local_fire_department', label: 'Rivalry', dest: '/rivalry', key: 'rivalry' },
    { icon: 'emoji_events', label: 'Trophy Room', dest: '/awards', key: 'trophy_room' },
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
            { icon: 'groups', label: 'Players', dest: '/players' },
            { icon: 'leaderboard', label: 'Standings', dest: '/standings' },
            { icon: 'view_comfy', label: 'Drafts', dest: '/drafts' },
            { icon: 'swap_horiz', label: 'Transactions', dest: '/transactions' },
            { icon: 'military_tech', label: 'Records', dest: '/records' },
            { icon: 'format_list_numbered', label: 'Scoring Format', dest: '/scoring' },
            { icon: 'history_edu', label: 'Constitution', dest: '/constitution' },
            // Label and destination depend on the connected platform -- see
            // getPlatformLink in utils/platformLinks.
            { icon: 'sports_football', label: 'Go to Sleeper', dest: `https://sleeper.app/leagues/`, platformLink: true }
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