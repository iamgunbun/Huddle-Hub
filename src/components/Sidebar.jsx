import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLeague } from '../context/LeagueContext';
import { supabase } from '../supabaseClient';
import styles from './Sidebar.module.css';

export default function Sidebar({ isOpen, onClose }) {
    const navigate = useNavigate();
    
    const { activeLeague, userLeaguesList = [], switchActiveLeague, loadLeagueContext } = useLeague() || {};
    
    const [infoOpen, setInfoOpen] = useState(false);
    const [hoveredLeague, setHoveredLeague] = useState(null);

    const handleSwitchLeague = async (id) => {
        await switchActiveLeague(id);
        if (onClose) onClose();
        navigate('/');
    };

    const handleSignOut = async () => {
        await supabase.auth.signOut();
        navigate('/login');
    };

    const handleDeleteLeague = async (e, leagueId) => {
        e.stopPropagation();
        const confirmDelete = window.confirm("Are you sure you want to disconnect this league?");
        if (!confirmDelete) return;

        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
            const { error } = await supabase
                .from('user_leagues')
                .delete()
                .eq('user_id', session.user.id)
                .eq('league_id', leagueId);

            if (!error) {
                await loadLeagueContext(session.user.id);
                if (activeLeague?.id === leagueId) navigate('/');
            }
        }
    };

    return (
        <div className={`${styles.overlay} ${isOpen ? styles.open : ''}`} onClick={onClose}>
            <div className={styles.sidebar} onClick={e => e.stopPropagation()} style={{ maxHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
                
                <div className={styles.top}>
                    <img src="/brand.png" alt="Huddle FF Logo" className={styles.brandLogo} />
                    <button onClick={onClose} className={styles.closeBtn}>
                        <i className="material-icons">close</i>
                    </button>
                </div>

                <div className={styles.menuContainer} style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: '100px' }}>
                    
                    <div className={styles.section}>
                        {/* Hidden on mobile, visible on desktop */}
                        <div className="desktopNavOnly">
                            <h4>Menu</h4>
                            <div className={styles.link} onClick={() => {navigate('/'); if(onClose) onClose();}}>
                                <i className="material-icons">home</i> Home
                            </div>
                            <div className={styles.link} onClick={() => {navigate('/matchups'); if(onClose) onClose();}}>
                                <i className="material-icons">bolt</i> Vs
                            </div>
                            <div className={styles.link} onClick={() => {navigate('/rosters'); if(onClose) onClose();}}>
                                <i className="material-icons">badge</i> My Team
                            </div>
                            <div className={styles.link} onClick={() => {navigate('/players'); if(onClose) onClose();}}>
                                <i className="material-icons">groups</i> Players
                            </div>
                            <div className={styles.link} onClick={() => {navigate('/transactions'); if(onClose) onClose();}}>
                                <i className="material-icons">swap_horiz</i> Transactions
                            </div>
                            {/* Desktop Messages Link */}
                            <div className={styles.link} onClick={() => {navigate('/messages'); if(onClose) onClose();}}>
                                <i className="material-icons">chat</i> Messages
                            </div>
                        </div>
                        
                        <div className={`${styles.dropdown} ${infoOpen ? styles.activeDropdown : ''}`} onClick={() => setInfoOpen(!infoOpen)} style={{ marginTop: '10px' }}>
                            <div className={styles.dropdownLabel}>
                                <i className="material-icons">view_comfy</i> League Info
                            </div>
                            <i className={`material-icons ${styles.chevron} ${infoOpen ? styles.chevronOpen : ''}`}>expand_more</i>
                        </div>
                        
                        <div className={`${styles.nested} ${infoOpen ? styles.nestedOpen : ''}`}>
                            <div onClick={() => {navigate('/managers'); if(onClose) onClose();}}><i className="material-icons">people</i> Managers</div>
                            <div onClick={() => {navigate('/rivalry'); if(onClose) onClose();}}><i className="material-icons">local_fire_department</i> Rivalry</div>
                            <div onClick={() => {navigate('/standings'); if(onClose) onClose();}}><i className="material-icons">leaderboard</i> Standings</div>
                            <div onClick={() => {navigate('/drafts'); if(onClose) onClose();}}><i className="material-icons">event_note</i> Drafts</div>
                            <div onClick={() => {navigate('/awards'); if(onClose) onClose();}}><i className="material-icons">emoji_events</i> Trophy Room</div>
                            <div onClick={() => {navigate('/records'); if(onClose) onClose();}}><i className="material-icons">military_tech</i> Records</div>
                            <div onClick={() => {navigate('/scoring'); if(onClose) onClose();}}><i className="material-icons">format_list_numbered</i> Scoring Format</div>
                            <div onClick={() => {navigate('/constitution'); if(onClose) onClose();}}><i className="material-icons">history_edu</i> Constitution</div>
                            <div onClick={() => {
                                window.open(`https://sleeper.app/leagues/${activeLeague?.sleeper_league_id || ''}`, '_blank');
                                if (onClose) onClose();
                            }}>
                                <i className="material-icons">sports_football</i> Go to Sleeper
                            </div>
                        </div>
                    </div>

                    <div className={styles.section}>
                        <h4>Switch League</h4>
                        {userLeaguesList.map(l => (
                            <div 
                                key={l.id} 
                                className={styles.leagueItem} 
                                onClick={() => handleSwitchLeague(l.id)}
                                onMouseEnter={() => setHoveredLeague(l.id)}
                                onMouseLeave={() => setHoveredLeague(null)}
                                style={{ position: 'relative' }}
                            >
                                {l.avatar ? (
                                    <img 
                                        src={l.avatar} 
                                        alt="Logo" 
                                        className={styles.leagueItemAvatar} 
                                        style={{ borderColor: activeLeague?.id === l.id ? '#eebf1c' : '#475569' }} 
                                        onError={(e) => e.target.src = 'https://sleepercdn.com/images/v2/icons/league_default.webp'}
                                    />
                                ) : (
                                    <div className={styles.radio} style={{ backgroundColor: activeLeague?.id === l.id ? '#eebf1c' : 'transparent', borderColor: activeLeague?.id === l.id ? '#eebf1c' : '#475569' }}></div>
                                )}
                                <span className={activeLeague?.id === l.id ? styles.activeLeagueText : ''}>{l.name || l.league_name}</span>
                                
                                {hoveredLeague === l.id && (
                                    <div 
                                        onClick={(e) => handleDeleteLeague(e, l.id)}
                                        style={{
                                            position: 'absolute',
                                            right: '10px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: '#ef4444',
                                            background: 'rgba(239, 68, 68, 0.1)',
                                            borderRadius: '6px',
                                            padding: '4px',
                                            cursor: 'pointer',
                                            zIndex: 10
                                        }}
                                    >
                                        <i className="material-icons" style={{ fontSize: '18px' }}>delete</i>
                                    </div>
                                )}
                            </div>
                        ))}
                        <div className={styles.link} style={{color: '#eebf1c', marginTop: '10px'}} onClick={() => {navigate('/add-league'); if(onClose) onClose();}}>
                            <i className="material-icons">add_circle_outline</i> Connect League
                        </div>
                    </div>
                </div>

                <div className={styles.footer}>
                    <div className={styles.logoutLink} onClick={handleSignOut}>
                        <i className="material-icons">logout</i> Log Out
                    </div>
                </div>
            </div>
        </div>
    );
}