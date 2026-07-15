import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLeague } from '../context/LeagueContext';
import styles from './Sidebar.module.css';

export default function Sidebar({ isOpen, onClose }) {
    const navigate = useNavigate();
    const { activeLeague, userLeaguesList, switchActiveLeague } = useLeague();
    
    const [infoOpen, setInfoOpen] = useState(false);
    const [commishOpen, setCommishOpen] = useState(false);

    const handleSwitchLeague = async (id) => {
        await switchActiveLeague(id);
        onClose();
        navigate('/');
    };

    return (
        <div className={`${styles.overlay} ${isOpen ? styles.open : ''}`} onClick={onClose}>
            <div className={styles.sidebar} onClick={e => e.stopPropagation()}>
                
                <div className={styles.top}>
                    <img src="/brand.png" alt="Huddle Logo" className={styles.brandLogo} />
                    <button onClick={onClose} className={styles.closeBtn}>
                        <i className="material-icons">close</i>
                    </button>
                </div>

                <div className={styles.menuContainer}>
                    <div className="desktopNavOnly">
                        <div className={styles.section}>
                            <h4>Menu</h4>
                            <div className={styles.link} onClick={() => {navigate('/'); onClose();}}>
                                <i className="material-icons">home</i> Home
                            </div>
                            <div className={styles.link} onClick={() => {navigate('/matchups'); onClose();}}>
                                <i className="material-icons">sports_football</i> Matchups
                            </div>
                            <div className={styles.link} onClick={() => {navigate('/transactions'); onClose();}}>
                                <i className="material-icons">swap_horiz</i> Trades & Waivers
                            </div>
                            
                            <div className={`${styles.dropdown} ${infoOpen ? styles.activeDropdown : ''}`} onClick={() => setInfoOpen(!infoOpen)}>
                                <div className={styles.dropdownLabel}>
                                    <i className="material-icons">view_comfy</i> League Info
                                </div>
                                <i className={`material-icons ${styles.chevron} ${infoOpen ? styles.chevronOpen : ''}`}>expand_more</i>
                            </div>
                            
                            <div className={`${styles.nested} ${infoOpen ? styles.nestedOpen : ''}`}>
                                <div onClick={() => {navigate('/rosters'); onClose();}}><i className="material-icons">storage</i> Teams</div>
                                <div onClick={() => {navigate('/managers'); onClose();}}><i className="material-icons">people</i> Managers</div>
                                <div onClick={() => {navigate('/rivalry'); onClose();}}><i className="material-icons">local_fire_department</i> Rivalry</div>
                                <div onClick={() => {navigate('/standings'); onClose();}}><i className="material-icons">leaderboard</i> Standings</div>
                                <div onClick={() => {navigate('/drafts'); onClose();}}><i className="material-icons">event_note</i> Drafts</div>
                                <div onClick={() => {navigate('/awards'); onClose();}}><i className="material-icons">emoji_events</i> Trophy Room</div>
                                <div onClick={() => {navigate('/records'); onClose();}}><i className="material-icons">military_tech</i> Records</div>
                                <div onClick={() => {navigate('/constitution'); onClose();}}><i className="material-icons">history_edu</i> Constitution</div>
                            </div>
                        </div>
                    </div>

                    {activeLeague?.is_commissioner && (
                        <div className={styles.section}>
                            <h4 className={styles.commishHeader}>Commissioner Settings</h4>
                            <div className={`${styles.dropdown} ${styles.commishTrigger}`} onClick={() => setCommishOpen(!commishOpen)}>
                                <div className={styles.dropdownLabel}>
                                    <i className="material-icons">gavel</i> Admin Settings
                                </div>
                                <i className={`material-icons ${styles.chevron} ${commishOpen ? styles.chevronOpen : ''}`}>expand_more</i>
                            </div>
                            
                            <div className={`${styles.nested} ${commishOpen ? styles.nestedOpen : ''}`}>
                                <div onClick={() => {navigate('/admin/notes'); onClose();}}><i className="material-icons">edit_note</i> Edit Commish Note</div>
                                <div onClick={() => {navigate('/admin/constitution'); onClose();}}><i className="material-icons">gavel</i> Amend Constitution</div>
                                <div onClick={() => {navigate('/admin/fees'); onClose();}}><i className="material-icons">payments</i> Manage League Dues</div>
                            </div>
                        </div>
                    )}

                    <div className={styles.section}>
                        <h4>Switch League</h4>
                        {userLeaguesList.map(l => (
                            <div key={l.id} className={styles.leagueItem} onClick={() => handleSwitchLeague(l.id)}>
                                {l.avatar ? (
                                    <img src={l.avatar} alt="Logo" className={styles.leagueItemAvatar} style={{ borderColor: activeLeague?.id === l.id ? '#eebf1c' : '#475569' }} />
                                ) : (
                                    <div className={styles.radio} style={{ backgroundColor: activeLeague?.id === l.id ? '#eebf1c' : 'transparent', borderColor: activeLeague?.id === l.id ? '#eebf1c' : '#475569' }}></div>
                                )}
                                <span className={activeLeague?.id === l.id ? styles.activeLeagueText : ''}>{l.name}</span>
                            </div>
                        ))}
                        <div className={styles.link} style={{color: '#eebf1c', marginTop: '10px'}} onClick={() => {navigate('/add-league'); onClose();}}>
                            <i className="material-icons">add_circle_outline</i> Connect League
                        </div>
                    </div>
                </div>

                <div className={styles.footer}>
                    <div className={styles.logoutLink} onClick={() => navigate('/login')}>
                        <i className="material-icons">logout</i> Log Out
                    </div>
                </div>
            </div>
        </div>
    );
}