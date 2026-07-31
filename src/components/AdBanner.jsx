import React from 'react';
import { useLeague } from '../context/LeagueContext';

export default function AdBanner({ slotId = "default-ad-slot" }) {
    const { isPremium } = useLeague();

    // If the user has lifetime access or paid for the season, render absolutely nothing.
    if (isPremium) {
        return null; 
    }

    // Otherwise, render the ad container
    return (
        <div style={{ 
            width: '100%', 
            display: 'flex', 
            justifyContent: 'center', 
            alignItems: 'center', 
            padding: '15px 0',
            margin: '20px 0',
            background: 'rgba(255,255,255,0.02)',
            borderTop: '1px solid rgba(255,255,255,0.05)',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
            boxSizing: 'border-box'
        }}>
            <div 
                id={slotId}
                style={{
                    width: '320px',
                    height: '50px',
                    background: '#1e2530',
                    color: '#64748b',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.8em',
                    fontWeight: 'bold',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    borderRadius: '4px'
                }}
            >
                Advertisement Space
            </div>
        </div>
    );
}