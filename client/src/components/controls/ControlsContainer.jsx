import React from 'react';
import './controlscontainer.css';

/**
 * The `ControlsContainer` is just a wrapper for other control components.
 * It defines their position and also their style with its CSS class `react-cy-controls`.
 *
 * ```jsx
 * <GraphContainer>
 *   <ControlsContainer position={"bottom-right"}>
 *     ...
 *   </ControlsContainer>
 * </GraphContainer>
 * ```
 * @category Component
 */
const ControlsContainer = ({
    id,
    className,
    style,
    children,
    position = 'bottom-left',
}) => {
    // Common html props for the container
    const props = {
        className: `react-cy-controls ${
            className ? className : ''
        } ${position}`,
        id,
        style,
    };

    return <div {...props}>{children}</div>;
};

export default ControlsContainer;
