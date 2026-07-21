import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useLeague } from '../context/LeagueContext';
import styles from './SettingsModal.module.css';

export default function SettingsModal({ onClose }) {
    const navigate = useNavigate();
    const { activeLeague } = useLeague();
    const [user, setUser] = useState(null);

    useEffect(() => {
        const fetchUser = async () => {
            const { data: sessionData } = await supabase.auth.getSession();
            if (sessionData?.session?.user) {
                setUser(sessionData.session.user);
            }
        };
        fetchUser();
    }, []);

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