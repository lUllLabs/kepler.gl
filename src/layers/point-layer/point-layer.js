// Copyright (c) 2019 Uber Technologies, Inc.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

import memoize from 'lodash.memoize';
import uniq from 'lodash.uniq';
import {TextLayer} from 'deck.gl';

import Layer from '../base-layer';
import ScatterplotBrushingLayer from 'deckgl-layers/scatterplot-brushing-layer/scatterplot-brushing-layer';
import {hexToRgb} from 'utils/color-utils';
import PointLayerIcon from './point-layer-icon';
import {DEFAULT_LAYER_COLOR, CHANNEL_SCALES} from 'constants/default-settings';

export const pointPosAccessor = ({lat, lng, altitude}) => d => [
  // lng
  d.data[lng.fieldIdx],
  // lat
  d.data[lat.fieldIdx],
  // altitude
  altitude && altitude.fieldIdx > -1 ? d.data[altitude.fieldIdx] : 0
];

export const pointPosResolver = ({lat, lng, altitude}) =>
  `${lat.fieldIdx}-${lng.fieldIdx}-${altitude ? altitude.fieldIdx : 'z'}`;

export const pointLabelAccessor = textLabel => d =>
  String(d.data[textLabel.field.tableFieldIndex - 1]);
export const pointLabelResolver = textLabel =>
  textLabel.field && textLabel.field.tableFieldIndex;

export const pointRequiredColumns = ['lat', 'lng'];
export const pointOptionalColumns = ['altitude'];

export const pointVisConfigs = {
  radius: 'radius',
  fixedRadius: 'fixedRadius',
  opacity: 'opacity',
  outline: 'outline',
  thickness: 'thickness',
  strokeColor: 'strokeColor',
  colorRange: 'colorRange',
  strokeColorRange: 'strokeColorRange',
  radiusRange: 'radiusRange',
  filled: {
    type: 'boolean',
    label: 'Fill Color',
    defaultValue: true,
    property: 'filled'
  }
};

export default class PointLayer extends Layer {
  constructor(props) {
    super(props);

    this.registerVisConfig(pointVisConfigs);
    this.getPosition = memoize(pointPosAccessor, pointPosResolver);
    this.getText = memoize(pointLabelAccessor, pointLabelResolver);
  }

  get type() {
    return 'point';
  }

  get isAggregated() {
    return false;
  }

  get layerIcon() {
    return PointLayerIcon;
  }
  get requiredLayerColumns() {
    return pointRequiredColumns;
  }

  get optionalColumns() {
    return pointOptionalColumns;
  }

  get columnPairs() {
    return this.defaultPointColumnPairs;
  }

  get noneLayerDataAffectingProps() {
    return [...super.noneLayerDataAffectingProps, 'radius'];
  }

  get visualChannels() {
    return {
      ...super.visualChannels,
      strokeColor: {
        property: 'strokeColor',
        field: 'strokeColorField',
        scale: 'strokeColorScale',
        domain: 'strokeColorDomain',
        range: 'strokeColorRange',
        key: 'strokeColor',
        channelScaleType: CHANNEL_SCALES.color
      },
      size: {
        ...super.visualChannels.size,
        range: 'radiusRange',
        property: 'radius',
        channelScaleType: 'radius'
      }
    };
  }

  getPositionAccessor() {
    return this.getPosition(this.config.columns);
  }

  static findDefaultLayerProps({fieldPairs = []}) {
    const props = [];

    // Make layer for each pair
    fieldPairs.forEach(pair => {
      // find fields for tableFieldIndex
      const latField = pair.pair.lat;
      const lngField = pair.pair.lng;
      const layerName = pair.defaultName;

      const prop = {
        label: layerName.length ? layerName : 'Point'
      };

      // default layer color for begintrip and dropoff point
      if (latField.value in DEFAULT_LAYER_COLOR) {
        prop.color = hexToRgb(DEFAULT_LAYER_COLOR[latField.value]);
      }

      // set the first layer to be visible
      if (props.length === 0) {
        prop.isVisible = true;
      }

      prop.columns = {
        lat: latField,
        lng: lngField,
        altitude: {value: null, fieldIdx: -1, optional: true}
      };

      props.push(prop);
    });

    return props;
  }

  getDefaultLayerConfig(props = {}) {
    return {
      ...super.getDefaultLayerConfig(props),

      // add stroke color visual channel
      strokeColorField: null,
      strokeColorDomain: [0, 1],
      strokeColorScale: 'quantile'
    };
  }

  // TODO: fix complexity
  /* eslint-disable complexity */
  formatLayerData(_, allData, filteredIndex, oldLayerData, opt = {}) {
    const {
      colorScale,
      colorDomain,
      colorField,
      strokeColorField,
      strokeColorScale,
      strokeColorDomain,
      color,
      sizeField,
      sizeScale,
      sizeDomain,
      textLabel,
      visConfig: {
        radiusRange,
        fixedRadius,
        colorRange,
        strokeColorRange,
        strokeColor
      }
    } = this.config;

    // fill color
    const cScale =
      colorField &&
      this.getVisChannelScale(
        colorScale,
        colorDomain,
        colorRange.colors.map(hexToRgb)
      );

    // stroke color
    const scScale =
      strokeColorField &&
      this.getVisChannelScale(
        strokeColorScale,
        strokeColorDomain,
        strokeColorRange.colors.map(hexToRgb)
      );

    // point radius
    const rScale =
      sizeField &&
      this.getVisChannelScale(sizeScale, sizeDomain, radiusRange, fixedRadius);

    const getPosition = this.getPositionAccessor();

    if (!oldLayerData || oldLayerData.getPosition !== getPosition) {
      this.updateLayerMeta(allData, getPosition);
    }

    let data;
    if (
      oldLayerData &&
      oldLayerData.data &&
      opt.sameData &&
      oldLayerData.getPosition === getPosition
    ) {
      data = oldLayerData.data;
    } else {
      data = filteredIndex.reduce((accu, index) => {
        const pos = getPosition({data: allData[index]});

        // if doesn't have point lat or lng, do not add the point
        // deck.gl can't handle position = null
        if (!pos.every(Number.isFinite)) {
          return accu;
        }

        accu.push({
          data: allData[index]
        });

        return accu;
      }, []);
    }

    // get all distinct characters in the text labels
    const getText = this.getText(textLabel);
    let labelCharacterSet;
    if (
      oldLayerData &&
      oldLayerData.labelCharacterSet &&
      opt.sameData &&
      oldLayerData.getText === getText
    ) {
      labelCharacterSet = oldLayerData.labelCharacterSet;
    } else {
      const textLabels = textLabel.field ? data.map(getText) : [];
      labelCharacterSet = uniq(textLabels.join(''));
    }

    const getRadius = rScale
      ? d => this.getEncodedChannelValue(rScale, d.data, sizeField)
      : 1;

    const getFillColor = cScale
      ? d => this.getEncodedChannelValue(cScale, d.data, colorField)
      : color;

    const getLineColor = scScale
      ? d => this.getEncodedChannelValue(scScale, d.data, strokeColorField)
      : strokeColor || color;
    return {
      data,
      labelCharacterSet,
      getPosition,
      getFillColor,
      getLineColor,
      getRadius,
      getText
    };
  }
  /* eslint-enable complexity */

  updateLayerMeta(allData) {
    const getPosition = this.getPositionAccessor();
    const bounds = this.getPointsBounds(allData, d => getPosition({data: d}));
    this.updateMeta({bounds});
  }

  renderLayer({
    data,
    idx,
    layerInteraction,
    objectHovered,
    mapState,
    interactionConfig
  }) {
    const enableBrushing = interactionConfig.brush.enabled;

    const layerProps = {
      // TODO: support setting stroke and fill simultaneously
      stroked: this.config.visConfig.outline,
      filled: this.config.visConfig.filled,
      radiusMinPixels: 1,
      lineWidthMinPixels: this.config.visConfig.thickness,
      radiusScale: this.getRadiusScaleByZoom(mapState),
      ...(this.config.visConfig.fixedRadius ? {} : {radiusMaxPixels: 500})
    };

    const interaction = {
      autoHighlight: !enableBrushing,
      enableBrushing,
      brushRadius: interactionConfig.brush.config.size * 1000,
      highlightColor: this.config.highlightColor
    };

    return [
      new ScatterplotBrushingLayer({
        ...layerProps,
        ...layerInteraction,
        ...data,
        ...interaction,

        idx,
        id: this.id,
        opacity: this.config.visConfig.opacity,
        pickable: true,
        parameters: {
          // circles will be flat on the map when the altitude column is not used
          depthTest: this.config.columns.altitude.fieldIdx > -1
        },

        updateTriggers: {
          getPosition: {
            columns: this.config.columns
          },
          getRadius: {
            sizeField: this.config.sizeField,
            radiusRange: this.config.visConfig.radiusRange,
            fixedRadius: this.config.visConfig.fixedRadius,
            sizeScale: this.config.sizeScale
          },
          getFillColor: {
            color: this.config.color,
            colorField: this.config.colorField,
            colorRange: this.config.visConfig.colorRange,
            colorScale: this.config.colorScale
          },
          getLineColor: {
            color: this.config.visConfig.strokeColor,
            colorField: this.config.strokeColorField,
            colorRange: this.config.visConfig.strokeColorRange,
            colorScale: this.config.strokeColorScale
          },
          getText: {
            textLabel: this.config.textLabel
          }
        }
      }),
      // hover layer
      ...(this.isLayerHovered(objectHovered)
        ? [
            new ScatterplotBrushingLayer({
              ...layerProps,
              id: `${this.id}-hovered`,
              data: [objectHovered.object],
              getLineColor: this.config.highlightColor,
              getFillColor: this.config.highlightColor,
              getRadius: data.getRadius,
              getPosition: data.getPosition,
              pickable: false
            })
          ]
        : []),
      // text label layer
      ...(this.config.textLabel.field
        ? [
            new TextLayer({
              ...layerInteraction,
              id: `${this.id}-label`,
              data: data.data,
              getPosition: data.getPosition,
              getPixelOffset: this.config.textLabel.offset,
              getSize: this.config.textLabel.size,
              getTextAnchor: this.config.textLabel.anchor,
              getText: data.getText,
              getColor: d => this.config.textLabel.color,
              parameters: {
                // text will always show on top of all layers
                depthTest: false
              },
              characterSet: data.labelCharacterSet,
              updateTriggers: {
                getPosition: data.getPosition,
                getPixelOffset: this.config.textLabel.offset,
                getText: this.config.textLabel.field,
                getTextAnchor: this.config.textLabel.anchor,
                getSize: this.config.textLabel.size,
                getColor: this.config.textLabel.color
              }
            })
          ]
        : [])
    ];
  }
}
