import React from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './BackButton.module.css';

export default function BackButton({ fallback = '/' }) {
    const navigate = useNavigate();

    const handleBack = () => {
        // Safely go back in browser history, or default to the homepage if opened directly
        if (window.history.length > 2) {
            navigate(-1);
        } else {
            navigate(fallback, { replace: true });
        }
    };

    return (
        <button className={styles.backBtn} onClick={handleBack}>
            <i className="material-icons">arrow_back</i>
            <span>Back to League</span>
        </button>
    );
}