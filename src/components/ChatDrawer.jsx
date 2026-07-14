import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { useLeague } from '../context/LeagueContext';
import { getLeagueTeamManagers } from '../utils/helper';
import EmojiPicker from 'emoji-picker-react';
import styles from './ChatDrawer.module.css';

export default function ChatDrawer() {
    const { activeLeague } = useLeague();
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState([]);
    
    // Message States
    const [newMessage, setNewMessage] = useState('');
    const [uploadingImage, setUploadingImage] = useState(false);
    
    // Notification State
    const [unreadCount, setUnreadCount] = useState(0);
    const [pushEnabled, setPushEnabled] = useState(Notification.permission === 'granted');
    
    // User Identity States
    const [currentUser, setCurrentUser] = useState(null);
    const [authorName, setAuthorName] = useState('Unknown Team');
    const [authorAvatar, setAuthorAvatar] = useState('https://sleepercdn.com/images/v2/icons/player_default.webp');
    
    // Picker Menus
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [showGifPicker, setShowGifPicker] = useState(false);
    const [gifSearch, setGifSearch] = useState('');
    const [gifResults, setGifResults] = useState([]);
    const [isSearchingGif, setIsSearchingGif] = useState(false);

    // Refs for Websocket context & Deduplication
    const messagesEndRef = useRef(null);
    const fileInputRef = useRef(null);
    const isOpenRef = useRef(isOpen);
    const currentUserRef = useRef(null);
    const processedMessagesRef = useRef(new Set()); // The Memory Bank!

    const GIPHY_API_KEY = "Uc7v3mjehbCz4pCMtEgT2ii78xLOyKg9"; // Remember to paste your key back here!

    useEffect(() => {
        isOpenRef.current = isOpen;
        if (isOpen) {
            setUnreadCount(0); 
        }
    }, [isOpen]);

    const requestNotifications = () => {
        if (!("Notification" in window)) {
            alert("This browser does not support system notifications.");
            return;
        }
        Notification.requestPermission().then(permission => {
            setPushEnabled(permission === 'granted');
        });
    };

    useEffect(() => {
        let channel;

        const initChat = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) {
                setCurrentUser(session.user);
                currentUserRef.current = session.user; 
                
                if (activeLeague) {
                    const { data: ulData } = await supabase
                        .from('user_leagues')
                        .select('team_name')
                        .eq('user_id', session.user.id)
                        .eq('league_id', activeLeague.id)
                        .single();
                        
                    if (ulData?.team_name) setAuthorName(ulData.team_name);

                    const tmData = await getLeagueTeamManagers(activeLeague.sleeper_league_id);
                    if (tmData && ulData?.team_name) {
                        const rosters = tmData.teamManagersMap[tmData.currentSeason] || {};
                        for (const rId in rosters) {
                            if (rosters[rId].team?.name?.toLowerCase() === ulData.team_name.toLowerCase()) {
                                if (rosters[rId].team.avatar) {
                                    setAuthorAvatar(rosters[rId].team.avatar);
                                }
                                break;
                            }
                        }
                    }
                }
            }

            if (activeLeague?.id) {
                const { data, error } = await supabase
                    .from('messages')
                    .select('*')
                    .eq('league_id', activeLeague.id)
                    .order('created_at', { ascending: true })
                    .limit(100);
                
                if (!error && data) {
                    setMessages(data);
                    // Add historical messages to memory bank so they don't accidentally trigger notifications
                    data.forEach(msg => processedMessagesRef.current.add(msg.id));
                }

                const uniqueChannelName = `league_chat_${activeLeague.id}_${Math.random()}`;
                
                channel = supabase.channel(uniqueChannelName)
                    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
                        if (payload.new.league_id === activeLeague.id) {
                            
                            // 1. THE SHIELD: Instantly kill duplicate payloads from React Strict Mode
                            if (processedMessagesRef.current.has(payload.new.id)) return;
                            processedMessagesRef.current.add(payload.new.id);
                            
                            // 2. Append message to screen
                            setMessages(prev => [...prev, payload.new]);

                            // 3. Trigger Notifications ONLY if the message isn't from you
                            if (payload.new.user_id !== currentUserRef.current?.id) {
                                
                                // Visual App Badge
                                if (!isOpenRef.current) {
                                    setUnreadCount(prev => prev + 1);
                                }

                                // System Push Notification
                                if (Notification.permission === 'granted') {
                                    if (document.visibilityState !== 'visible' || !isOpenRef.current) {
                                        new Notification(payload.new.author_name, {
                                            body: payload.new.content || 'Sent an attachment',
                                            icon: payload.new.author_avatar || '/brand.png',
                                            silent: false
                                        });
                                    }
                                }
                            }
                        }
                    }).subscribe();
            }
        };

        initChat();

        return () => {
            if (channel) supabase.removeChannel(channel);
        };
    }, [activeLeague]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isOpen, showEmojiPicker, showGifPicker]);

    const sendPayload = async (payload) => {
        if (!activeLeague || !currentUser) return;
        
        const { error } = await supabase.from('messages').insert({
            league_id: activeLeague.id,
            user_id: currentUser.id,
            author_name: authorName,
            author_avatar: authorAvatar,
            ...payload
        });

        if (error) console.error("Message error:", error);
    };

    const handleSendText = (e) => {
        e.preventDefault();
        if (!newMessage.trim()) return;

        sendPayload({ content: newMessage.trim() });
        setNewMessage('');
        setShowEmojiPicker(false);
    };

    const handleImageUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setUploadingImage(true);
        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}_${Math.random()}.${fileExt}`;
        const filePath = `${activeLeague.id}/${fileName}`;

        const { error: uploadError } = await supabase.storage
            .from('chat_images')
            .upload(filePath, file);

        if (uploadError) {
            console.error("Upload error:", uploadError);
            setUploadingImage(false);
            return;
        }

        const { data: { publicUrl } } = supabase.storage.from('chat_images').getPublicUrl(filePath);

        await sendPayload({ content: '', image_url: publicUrl });
        setUploadingImage(false);
    };

    const executeGifSearch = async () => {
        if (!gifSearch.trim() || GIPHY_API_KEY === "YOUR_NEW_KEY_HERE") {
            setGifResults([]);
            if (GIPHY_API_KEY === "YOUR_NEW_KEY_HERE") alert("Please add your Giphy API Key to the code first!");
            return;
        }
        setIsSearchingGif(true);
        try {
            const res = await fetch(`https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(gifSearch)}&limit=15`);
            const data = await res.json();
            setGifResults(data.data || []);
        } catch (err) {
            console.error("Giphy Search Error:", err);
        } finally {
            setIsSearchingGif(false);
        }
    };

    const handleGifKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault(); 
            executeGifSearch();
        }
    };

    const handleSendGif = (gifUrl) => {
        sendPayload({ content: '', gif_url: gifUrl });
        setShowGifPicker(false);
        setGifSearch('');
        setGifResults([]);
    };

    const onEmojiClick = (emojiObject) => {
        setNewMessage(prev => prev + emojiObject.emoji);
    };

    if (!activeLeague) return null;

    return (
        <>
            <button className={styles.floatingChatBtn} onClick={() => setIsOpen(!isOpen)}>
                <i className="material-icons">{isOpen ? 'close' : 'forum'}</i>
                {!isOpen && <span className={styles.chatLabel}>League Chat</span>}
                
                {/* UNREAD BADGE */}
                {!isOpen && unreadCount > 0 && (
                    <div className={styles.unreadBadge}>
                        {unreadCount > 99 ? '99+' : unreadCount}
                    </div>
                )}
            </button>

            <div className={`${styles.chatWidget} ${isOpen ? styles.open : ''}`}>
                <div className={styles.header}>
                    <div>
                        <h3 className={styles.title}>League Chat</h3>
                        <div className={styles.subtitle}>{activeLeague?.league_name}</div>
                    </div>
                    
                    {/* NOTIFICATION TOGGLE */}
                    <button 
                        className={styles.notifyBtn} 
                        onClick={requestNotifications} 
                        title={pushEnabled ? "Notifications Enabled" : "Enable Push Notifications"}
                    >
                        <i className="material-icons" style={{ color: pushEnabled ? '#eebf1c' : '#64748b' }}>
                            {pushEnabled ? 'notifications_active' : 'notifications_off'}
                        </i>
                    </button>
                </div>

                <div className={styles.messageArea}>
                    {messages.length === 0 ? (
                        <div className={styles.emptyState}>No messages yet. Start the trash talk!</div>
                    ) : (
                        messages.map((msg) => {
                            const isMe = msg.user_id === currentUser?.id;
                            const fallback = 'https://sleepercdn.com/images/v2/icons/player_default.webp';
                            
                            return (
                                <div key={msg.id} className={`${styles.messageRow} ${isMe ? styles.rowMe : styles.rowThem}`}>
                                    {!isMe && (
                                        <img src={msg.author_avatar || fallback} alt="Avatar" className={styles.chatAvatar} />
                                    )}
                                    <div className={`${styles.messageWrapper} ${isMe ? styles.myMessage : styles.theirMessage}`}>
                                        {!isMe && <div className={styles.author}>{msg.author_name}</div>}
                                        <div className={styles.bubble}>
                                            {msg.image_url && <img src={msg.image_url} className={styles.mediaAttachment} alt="Upload" />}
                                            {msg.gif_url && <img src={msg.gif_url} className={styles.mediaAttachment} alt="GIF" />}
                                            {msg.content && <span className={styles.textContent}>{msg.content}</span>}
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                    <div ref={messagesEndRef} />
                </div>

                <div className={styles.inputContainer}>
                    
                    {showEmojiPicker && (
                        <div className={styles.pickerOverlay}>
                            <EmojiPicker theme="dark" onEmojiClick={onEmojiClick} width="100%" height="300px" />
                        </div>
                    )}

                    {showGifPicker && (
                        <div className={styles.pickerOverlay}>
                            <div className={styles.gifSearchRow}>
                                <input 
                                    type="text" 
                                    className={styles.gifSearchInput} 
                                    placeholder="Search Giphy..." 
                                    value={gifSearch}
                                    onChange={(e) => setGifSearch(e.target.value)}
                                    onKeyDown={handleGifKeyDown}
                                />
                                <button 
                                    type="button" 
                                    className={styles.gifSearchExecuteBtn} 
                                    onClick={executeGifSearch}
                                    disabled={isSearchingGif}
                                >
                                    <i className="material-icons">{isSearchingGif ? 'hourglass_empty' : 'search'}</i>
                                </button>
                            </div>
                            
                            <div className={styles.gifGrid}>
                                {gifResults.map(gif => (
                                    <img 
                                        key={gif.id} 
                                        src={gif.images.fixed_height_small.url} 
                                        alt="gif" 
                                        className={styles.gifThumb}
                                        onClick={() => handleSendGif(gif.images.fixed_height.url)}
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    <div className={styles.actionTools}>
                        <button type="button" className={styles.toolBtn} onClick={() => fileInputRef.current.click()} disabled={uploadingImage}>
                            <i className="material-icons">add_photo_alternate</i>
                        </button>
                        <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" style={{ display: 'none' }} />
                        
                        <button type="button" className={`${styles.toolBtn} ${showGifPicker ? styles.activeTool : ''}`} onClick={() => { setShowGifPicker(!showGifPicker); setShowEmojiPicker(false); }}>
                            <i className="material-icons">gif</i>
                        </button>
                        
                        <button type="button" className={`${styles.toolBtn} ${showEmojiPicker ? styles.activeTool : ''}`} onClick={() => { setShowEmojiPicker(!showEmojiPicker); setShowGifPicker(false); }}>
                            <i className="material-icons">mood</i>
                        </button>
                    </div>

                    <form className={styles.inputWrapper} onSubmit={handleSendText}>
                        <input 
                            type="text" 
                            className={styles.inputField} 
                            placeholder={uploadingImage ? "Uploading image..." : "Type a message..."} 
                            value={newMessage}
                            onChange={(e) => setNewMessage(e.target.value)}
                            disabled={uploadingImage}
                        />
                        <button type="submit" className={styles.sendBtn} disabled={!newMessage.trim() || uploadingImage}>
                            <i className="material-icons">send</i>
                        </button>
                    </form>
                </div>
            </div>
        </>
    );
}