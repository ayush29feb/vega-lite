import {Model} from './Model';
import {contains, extend, truncate} from '../util';
import {NOMINAL, ORDINAL, QUANTITATIVE, TEMPORAL} from '../type';
import {COLUMN, ROW, X, Y, Channel} from '../channel';

// https://github.com/Microsoft/TypeScript/blob/master/doc/spec.md#11-ambient-declarations
declare var exports;

export function compileAxis(channel: Channel, model: Model) {
  const isCol = channel === COLUMN,
    isRow = channel === ROW,
    type = isCol ? 'x' : isRow ? 'y': channel;

  // TODO: replace any with Vega Axis Interface
  var def: any = {
    type: type,
    scale: model.scale(channel)
  };

  // 1. Add properties
  [
    // a) properties with special rules (so it has axis[property] methods) -- call rule functions
    'format', 'grid', 'layer', 'orient', 'tickSize', 'ticks', 'title',
    // b) properties without rules, only produce default values in the schema, or explicit value if specified
    'offset', 'tickPadding', 'tickSize', 'tickSizeMajor', 'tickSizeMinor', 'tickSizeEnd',
    'titleOffset', 'values', 'subdivide'
  ].forEach(function(property) {
    let method: (model: Model, channel: Channel, def:any)=>any;

    var value = (method = exports[property]) ?
                  // calling axis.format, axis.grid, ...
                  method(model, channel, def) :
                  model.fieldDef(channel).axis[property];
    if (value !== undefined) {
      def[property] = value;
    }
  });

  // 2) Add mark property definition groups
  var props = model.axis(channel).properties || {};

  [
    'axis', 'labels',// have special rules
    'grid', 'title', 'ticks', 'majorTicks', 'minorTicks' // only default values
  ].forEach(function(group) {
    var value = properties[group] ?
      properties[group](model, channel, props[group], def) :
      props[group];
    if (value !== undefined) {
      def.properties = def.properties || {};
      def.properties[group] = value;
    }
  });

  return def;
}

export function format(model: Model, channel: Channel) {
  const fieldDef = model.fieldDef(channel);
  var format = model.axis(channel).format;
  if (format !== undefined)  {
    return format;
  }

  if (fieldDef.type === QUANTITATIVE) {
    return model.numberFormat(channel);
  } else if (fieldDef.type === TEMPORAL) {
    const timeUnit = fieldDef.timeUnit;
    if (!timeUnit) {
      return model.config().timeFormat;
    } else if (timeUnit === 'year') {
      return 'd';
    }
  }
  return undefined;
}

export function grid(model: Model, channel: Channel) {
  const fieldDef = model.fieldDef(channel);
  var grid = model.axis(channel).grid;
  if (grid !== undefined) {
    return grid;
  }

  // If `grid` is unspecified, the default value is `true` for ordinal scales
  // that are not binned
  return !model.isOrdinalScale(channel) && !fieldDef.bin;
}

export function layer(model: Model, channel: Channel, def) {
  var layer = model.axis(channel).layer;
  if (layer !== undefined) {
    return layer;
  }
  if (def.grid) {
    // if grid is true, need to put layer on the back so that grid is behind marks
    return 'back';
  }
  return undefined; // otherwise return undefined and use Vega's default.
};

export function orient(model: Model, channel: Channel) {
  var orient = model.axis(channel).orient;
  if (orient) {
    return orient;
  } else if (channel === COLUMN) {
    // FIXME test and decide
    return 'top';
  } else if (channel === ROW) {
    if (model.has(Y) && model.axis(Y).orient !== 'right') {
      return 'right';
    }
  }
  return undefined;
}

export function ticks(model: Model, channel: Channel) {
  const ticks = model.axis(channel).ticks;
  if (ticks !== undefined) {
    return ticks;
  }

  // FIXME depends on scale type too
  if (channel === X && !model.fieldDef(channel).bin) {
    return 5;
  }

  return undefined;
}

export function tickSize(model: Model, channel: Channel) {
  const tickSize = model.axis(channel).tickSize;
  if (tickSize !== undefined) {
    return tickSize;
  }
  if (channel === ROW || channel === COLUMN) {
    return 0;
  }
  return undefined;
}


export function title(model: Model, channel: Channel) {
  var axis = model.axis(channel);
  if (axis.title !== undefined) {
    return axis.title;
  }

  // if not defined, automatically determine axis title from field def
  var fieldTitle = model.fieldTitle(channel);
  const layout = model.layout();
  const cellWidth = layout.cellWidth;
  const cellHeight = layout.cellHeight;

  var maxLength;
  if (axis.titleMaxLength) {
    maxLength = axis.titleMaxLength;
  } else if (channel === X && typeof cellWidth === 'number') {
    // Guess max length if we know cell size at compile time
    maxLength = cellWidth / model.axis(X).characterWidth;
  } else if (channel === Y && typeof cellHeight === 'number') {
    // Guess max length if we know cell size at compile time
    maxLength = cellHeight / model.axis(Y).characterWidth;
  }
  // FIXME: we should use template to truncate instead
  return maxLength ? truncate(fieldTitle, maxLength) : fieldTitle;
}

export namespace properties {
  export function axis(model: Model, channel: Channel, axisPropsSpec) {
    if (channel === ROW || channel === COLUMN) {
      // hide axis for facets
      return extend({
        opacity: {value: 0}
      }, axisPropsSpec || {});
    }
    return axisPropsSpec || undefined;
  }

  export function labels(model: Model, channel: Channel, labelsSpec, def) {
    const fieldDef = model.fieldDef(channel);
    const axis = model.axis(channel);

    if (!axis.labels) {
      return extend({
        text: ''
      }, labelsSpec);
    }

    let filterName = model.labelTemplate(channel);
    if (fieldDef.type === TEMPORAL && filterName) {
      labelsSpec = extend({
        text: {template: '{{datum.data | ' + filterName + '}}'}
      }, labelsSpec || {});
    }

    if (contains([NOMINAL, ORDINAL], fieldDef.type) && axis.labelMaxLength) {
      // TODO replace this with Vega's labelMaxLength once it is introduced
      labelsSpec = extend({
        text: {
          template: '{{ datum.data | truncate:' + axis.labelMaxLength + '}}'
        }
      }, labelsSpec || {});
    }

     // for x-axis, set ticks for Q or rotate scale for ordinal scale
    switch (channel) {
      case X:
        if (model.isDimension(X) || fieldDef.type === TEMPORAL) {
          labelsSpec = extend({
            angle: {value: 270},
            align: {value: def.orient === 'top' ? 'left': 'right'},
            baseline: {value: 'middle'}
          }, labelsSpec || {});
        }
        break;
      case ROW:
        if (def.orient === 'right') {
          labelsSpec = extend({
            angle: {value: 90},
            align: {value: 'center'},
            baseline: {value: 'bottom'}
          }, labelsSpec || {});
        }
    }

    return labelsSpec || undefined;
  }
}
