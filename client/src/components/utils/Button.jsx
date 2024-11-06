import React, { useState, useMemo } from 'react';
import PropTypes from 'prop-types';
import './button.css';

const Button = ({title, action, altIcon, altAction, active, altEnabled}) => {

    const primaryClasses = active ? 'primary active' : 'primary';

    return (
        <div className='button'>
            <button className={primaryClasses} onClick={action}>
            {title}
            </button>
            {altEnabled && (
                <button className='alt' onClick={altAction}>
                    {altIcon}
                </button>
            )}
        </div>
    );
}

Button.propTypes = {
    title: PropTypes.string,
    action: PropTypes.func,
    altIcon: PropTypes.element,
    altAction: PropTypes.func,
    altEnabled: PropTypes.bool,
    active: PropTypes.bool
};

// Button.defaultProps = {
//     title: undefined,
//     action: undefined,
//     altIcon: undefined,
//     altAction: undefined,
//     altEnabled: false,
//     active: false,
// };

  export default Button;
