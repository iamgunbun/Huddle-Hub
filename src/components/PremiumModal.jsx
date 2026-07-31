import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { Capacitor } from '@capacitor/core';
import { Purchases } from '@revenuecat/purchases-capacitor';
import styles from './PremiumModal.module.css';

export default function PremiumModal({ onClose }) {
    const [userId, setUserId] = useState(null);
    const [processing, setProcessing] = useState(false);

    useEffect(() => {
        const fetchUser = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) setUserId(user.id);
        };
        fetchUser();
    }, []);

    const handleUpgrade = async () => {
        if (!userId) {
            alert("Please log in to upgrade your account.");
            return;
        }

        setProcessing(true);

        // NATIVE CHECKOUT FLOW (Google Play / App Store via RevenueCat)
        if (Capacitor.isNativePlatform()) {
            try {
                // Link the purchase directly to the user's Supabase ID
                await Purchases.logIn({ appUserID: userId });
                
                // Fetch the $9.99 subscription package from RevenueCat
                const offerings = await Purchases.getOfferings();
                if (offerings.current !== null && offerings.current.availablePackages.length !== 0) {
                    
                    // Trigger the native bottom-sheet checkout
                    const { customerInfo } = await Purchases.purchasePackage({ 
                        package: offerings.current.availablePackages[0] 
                    });
                    
                    // Check if the payment successfully unlocked your "premium" tier
                    if (typeof customerInfo.entitlements.active['premium'] !== "undefined") {
                        // Immediately flip their status in Supabase so the web app syncs instantly
                        await supabase.from('profiles').update({ is_premium: true }).eq('id', userId);
                        alert("Welcome to Huddle Premium!");
                        window.location.reload(); 
                    }
                } else {
                    alert("No subscriptions available at this time.");
                }
            } catch (e) {
                if (!e.userCancelled) {
                    alert(`Transaction Error: ${e.message}`);
                }
            } finally {
                setProcessing(false);
            }
        } else {
            // WEB CHECKOUT FLOW (Stripe)
            // Passes the user's Supabase ID in the URL to the webhook
            const stripePaymentUrl = `https://buy.stripe.com/test_5kQ3cocYZ0dagfH81CeUU00`;
            window.location.href = stripePaymentUrl;
        }
    };

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                <button className={styles.closeBtn} onClick={onClose}>
                    <i className="material-icons">close</i>
                </button>
                
                <div className={styles.header}>
                    <i className="material-icons" style={{ fontSize: '48px', color: '#eebf1c', marginBottom: '15px' }}>workspace_premium</i>
                    <h2 className={styles.title}>Huddle Premium</h2>
                    <p className={styles.subtitle}>Unlock the ultimate dynasty experience.</p>
                </div>

                <ul className={styles.featureList}>
                    <li><i className="material-icons">check_circle</i> <span><strong>Ad-Free Experience:</strong> Zero interruptions.</span></li>
                    <li><i className="material-icons">check_circle</i> <span><strong>Unlimited Leagues:</strong> Connect as many leagues as you want (Free tier is limited to 2).</span></li>
                    <li><i className="material-icons">check_circle</i> <span><strong>Scouting Pipelines:</strong> Full access to the Trade and Draft Graders.</span></li>
                    <li><i className="material-icons">check_circle</i> <span><strong>Start/Sit Verdicts:</strong> Deep-dive tactical verdicts for your toughest lineup decisions.</span></li>
                    <li><i className="material-icons">check_circle</i> <span><strong>Extended Manager Evals:</strong> Up to 5 manual franchise evaluations per manager per season.</span></li>
                </ul>

                <button className={styles.upgradeBtn} onClick={handleUpgrade} disabled={processing}>
                    {processing ? 'Processing...' : 'Upgrade Now - $9.99 / Season'}
                </button>
            </div>
        </div>
    );
}