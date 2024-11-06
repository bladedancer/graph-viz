import React, { useState, useMemo } from 'react';
import PropTypes from 'prop-types';
import './slidetoggle.css';

const SlideToggle = (props) => {
  const { options, className, toggleClassName } = props;
  // eslint-disable-next-line react/destructuring-assignment
  const name = props.name || options.map((o) => o.value).join('-');
  const count = options.length;
  // eslint-disable-next-line react/destructuring-assignment
  const [selected, setSelected] = useState(props.selected); // selected value

  const selectedIndex = useMemo(() => options
    .findIndex((o) => o.value === selected), [selected, options]);

  const handleChange = (value) => {
    if (value !== selected) {
      setSelected(value);
      if (props.onChange) props.onChange(value);
    }
  };

  return (
    <span className={`slide-toggle ${(className || '')}`}>
      <span
        className={`toggle ${(toggleClassName || '')}`}
        style={{
          visibility: `${selected === undefined ? 'hidden' : 'visible'}`,
          width: `${100 / count}%`,
          left: `${selectedIndex * (100 / count)}%`,
        }}
      />
      {options.map((option) => (
        <span key={option.value}>
          <input
            type="radio"
            name={name}
            id={`${name}:${option.value}`}
            value={option.value}
            checked={selected === option.value}
            onChange={() => handleChange(option.value)}
          />
          <label
            htmlFor={`${name}:${option.value}`}
            style={{
              width: `${100 / count}%`,
            }}
          >
            {option.label}
          </label>
        </span>
      ))}
    </span>
  );
};

SlideToggle.propTypes = {
  name: PropTypes.string,
  options: PropTypes.arrayOf(PropTypes.shape()),
  selected: PropTypes.string,
  onChange: PropTypes.func,
  className: PropTypes.string,
  toggleClassName: PropTypes.string,
};

// SlideToggle.defaultProps = {
//   name: undefined,
//   selected: undefined,
//   onChange: undefined,
//   className: undefined,
//   toggleClassName: undefined,
//   options: [],
// };

export default SlideToggle;
