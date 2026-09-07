import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useLeague } from '../context/LeagueContext';
import { claimCommissionerRole } from '../utils/leagueAdmin';
import styles from './SettingsModal.module.css';

export default function SettingsModal({ onClose }) {
    const navigate = useNavigate();
    const { activeLeague, patchActiveLeague } = useLeague();
    const [user, setUser] = useState(null);
    const [claiming, setClaiming] = useState(false);
    const [claimMessage, setClaimMessage] = useState('');

    useEffect(() => {
        const fetchUser = async () => {
            const { data: sessionData } = await supabase.auth.getSession();
            if (sessionData?.session?.user) {
                setUser(sessionData.session.user);
            }
        };
        fetchUser();
    }, []);

    const handleClaimCommissioner = async () => {
        if (!activeLeague?.id || !user?.id) return;
        setClaiming(true);
        const result = await claimCommissionerRole(activeLeague.id, user.id);
        // Fold it straight into the context so the tools appear here without a
        // reload -- the whole point is that they were unreachable.
        if (result.ok) patchActiveLeague({ is_commissioner: true });
        setClaimMessage(result.message);
        setClaiming(false);
    };

    const handleNavigation = (path) => {
        navigate(path);
        onClose();
    };

    return (
        <div className={styles.modalOverlay} onClick={onClose}>
            <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
                
                <div className={styles.modalHeader}>
                    <h2>Settings & Support</h2>
                    <button className={styles.closeBtn} onClick={onClose}>
                        <i className="material-icons">close</i>
                    </button>
                </div>

                <div className={styles.settingsSection}>
                    <h3 className={styles.sectionTitle}>My Account</h3>
                    <button 
                        className={styles.navBtn}
                        onClick={() => handleNavigation('/account')}
                    >
                        <i className="material-icons">person</i> Edit Profile
                    </button>
                </div>

                {/*
                  * ESPN publishes nothing about who runs a league -- its member
                  * records carry only a name and an id, with no manager flag
                  * anywhere in the response -- so unlike Yahoo and Sleeper there
                  * is nothing to detect and the tools would otherwise stay
                  * permanently out of reach. Asking is the only honest option.
                  */}
                {activeLeague?.platform === 'espn' && !activeLeague?.is_commissioner && (
                    <div className={styles.settingsSection}>
                        <h3 className={styles.sectionTitle}>Commissioner Tools</h3>
                        <p style={{ color: '#94a3b8', fontSize: '0.85em', lineHeight: 1.4, margin: '0 0 10px' }}>
                            ESPN doesn't tell apps who a league's manager is, so this can't be
                            detected automatically. If you run this league, turn the tools on here.
                        </p>
                        {claimMessage && <div className={styles.navBtn} style={{ cursor: 'default' }}>{claimMessage}</div>}
                        <button className={styles.navBtn} onClick={handleClaimCommissioner} disabled={claiming}>
                            <i className="material-icons">verified_user</i>
                            {claiming ? 'Enabling...' : "I'm this league's manager"}
                        </button>
                    </div>
                )}

                {activeLeague?.is_commissioner && (
                    <div className={styles.settingsSection}>
                        <h3 className={styles.sectionTitle}>Commissioner Tools</h3>
                        <button className={styles.navBtn} onClick={() => handleNavigation('/admin/notes')}>
                            <i className="material-icons">edit_note</i> Edit Commish Note
                        </button>
                        <button className={styles.navBtn} onClick={() => handleNavigation('/admin/constitution')}>
                            <i className="material-icons">gavel</i> Amend Constitution
                        </button>
                        <button className={styles.navBtn} onClick={() => handleNavigation('/admin/fees')}>
                            <i className="material-icons">payments</i> Manage League Dues
                        </button>
                    </div>
                )}

                <div className={`${styles.settingsSection} ${styles.divider}`}>
                    <h3 className={styles.sectionTitle}>Submit a Ticket</h3>
                    
                    {/* STANDARD HTML FORM ENDPOINT */}
                    {/* Replace the action URL with your free Formspree or Web3Forms endpoint connected to chatbyte12@gmail.com */}
                    <form 
                        action="https://formspree.io/f/mdaqzvnw" 
                        method="POST" 
                        className={styles.ticketForm}
                    >
                        {/* Hidden fields pass valuable debugging data to your email without the user typing it */}
                        <input type="hidden" name="user_id" value={user?.id || 'Unknown User'} />
                        <input type="hidden" name="user_email" value={user?.email || 'Unknown Email'} />
                        <input type="hidden" name="league_id" value={activeLeague?.id || 'Unknown League'} />
                        <input type="hidden" name="_subject" value="New Huddle Support Ticket" />
                        
                        <select 
                            name="ticket_type"
                            className={styles.dropdown}
                            required
                        >
                            <option value="bug">Report a Bug</option>
                            <option value="question">General Question</option>
                            <option value="feature">Feature Request</option>
                        </select>
                        
                        <textarea 
                            name="message"
                            className={styles.textArea}
                            placeholder="Describe the issue or ask your question here..."
                            required
                        />
                        
                        <button type="submit" className={styles.submitBtn}>
                            Submit Ticket
                        </button>
                    </form>
                </div>

            </div>
        </div>
    );
}